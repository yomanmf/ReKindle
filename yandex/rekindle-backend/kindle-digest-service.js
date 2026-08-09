"use strict";

var crypto = require("node:crypto");
var ymq = require("./ymq");

var JOBS_COLLECTION = "kindle_digest_jobs";
var CONFIG_DOCUMENT = "kindle_digest_config/current";
var TERMINAL_STATES = { sent: true, failed: true, canceled: true };
var ACTIVE_STATES = { queued: true, running: true };
var WORKER_PHASES = { collecting: true, building: true, sending: true };

async function handle(options) {
    options = options || {};
    var action = String(options.action || "");
    var body = options.body || {};
    var firestore = options.firestore;
    var env = options.env || process.env;
    var publish = options.publish || ymq.publish;
    if (!firestore) throw serviceError(500, "kindle-digest-storage", "Digest storage is not available.");

    if (options.worker === true) {
        requireWorker(options.workerToken, env);
        if (action === "sync") return syncOptions(firestore, body);
        if (action === "pull") return pullJob(firestore);
        if (action === "claim") return claimJob(firestore, body);
        if (action === "progress") return updateProgress(firestore, body);
        if (action === "check") return checkJob(firestore, body);
        if (action === "finish") return finishJob(firestore, body);
        if (action === "fail") return failJob(firestore, body);
        if (action === "canceled") return cancelFromWorker(firestore, body);
        throw serviceError(404, "kindle-digest-action", "Digest worker action was not found.");
    }

    var uid = String(options.uid || "");
    requireAllowedUser(uid, env);
    if (action === "options") return getOptions(firestore);
    if (action === "create") return createJob(firestore, uid, body, env, publish);
    if (action === "status") return getStatus(firestore, uid, body);
    if (action === "history") return getHistory(firestore, uid);
    if (action === "cancel") return cancelJob(firestore, uid, body);
    if (action === "retry") return retryJob(firestore, uid, body, env, publish);
    throw serviceError(404, "kindle-digest-action", "Digest action was not found.");
}

async function getOptions(firestore) {
    var snapshot = await firestore.doc(CONFIG_DOCUMENT).get();
    var config = snapshot.exists ? snapshot.data() || {} : {};
    return {
        sources: Array.isArray(config.sources) ? config.sources.map(publicSource) : [],
        limits: { lookbackDays: 30, articleLimit: 30 },
        online: Number(config.lastSeenAt || 0) >= Date.now() - 120000,
        updatedAt: Number(config.updatedAt || 0)
    };
}

async function createJob(firestore, uid, body, env, publish) {
    var jobs = await listJobs(firestore);
    var active = jobs.find(function (job) { return job.uid === uid && ACTIVE_STATES[job.state]; });
    if (active) {
        if (active.state === "queued") await publishJob(publish, env, active);
        return { job: publicJob(active), existing: true };
    }

    var mode = String(body.mode || "");
    if (mode !== "daily" && mode !== "digest") {
        throw serviceError(400, "kindle-digest-mode", "Digest mode must be daily or digest.");
    }
    var lookbackDays = boundedInteger(body.lookbackDays, 1, 30, "lookbackDays");
    var filter = String(body.filter || "important");
    if (filter !== "important" && filter !== "all") {
        throw serviceError(400, "kindle-digest-filter", "Digest filter must be important or all.");
    }
    var articleLimit = body.articleLimit === null || body.articleLimit === undefined || body.articleLimit === ""
        ? null
        : boundedInteger(body.articleLimit, 1, 30, "articleLimit");
    var source = await resolveSource(firestore, mode, body);
    var now = Date.now();
    var job = {
        id: crypto.randomUUID(),
        dispatchId: crypto.randomUUID(),
        uid: uid,
        mode: mode,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceUrl: source.url,
        allSources: mode === "digest",
        lookbackDays: lookbackDays,
        importantOnly: filter === "important",
        articleLimit: articleLimit,
        state: "queued",
        phase: "queued",
        message: "Waiting for the digest worker.",
        cancelRequested: false,
        createdAt: now,
        updatedAt: now
    };
    await firestore.collection(JOBS_COLLECTION).doc(job.id).set(job);
    await publishJob(publish, env, job);
    return { job: publicJob(job), existing: false };
}

async function resolveSource(firestore, mode, body) {
    var snapshot = await firestore.doc(CONFIG_DOCUMENT).get();
    var config = snapshot.exists ? snapshot.data() || {} : {};
    var sources = Array.isArray(config.sources) ? config.sources : [];
    if (!sources.length) throw serviceError(503, "kindle-digest-offline", "The digest worker has not published its sources yet.");
    if (mode === "digest") return validateSource(sources[0]);

    var sourceId = String(body.sourceId || "").trim();
    if (sourceId === "custom") {
        return { id: "custom", label: "Custom site", url: validatePublicHttpUrl(body.sourceUrl) };
    }
    var source = sources.find(function (candidate) { return candidate.id === sourceId; });
    if (!source) throw serviceError(400, "kindle-digest-source", "Select a supported digest source.");
    return validateSource(source);
}

async function getStatus(firestore, uid, body) {
    var jobs = await listJobs(firestore);
    var id = String(body.id || "");
    var job = id
        ? jobs.find(function (candidate) { return candidate.id === id && candidate.uid === uid; })
        : jobs.filter(function (candidate) { return candidate.uid === uid; }).sort(newestFirst)[0];
    return { job: job ? publicJob(job) : null };
}

async function getHistory(firestore, uid) {
    var jobs = (await listJobs(firestore)).filter(function (job) { return job.uid === uid; });
    jobs.sort(newestFirst);
    return { items: jobs.slice(0, 10).map(publicJob) };
}

async function cancelJob(firestore, uid, body) {
    var job = await ownedJob(firestore, uid, body.id);
    if (TERMINAL_STATES[job.state]) return { job: publicJob(job) };
    var update = { cancelRequested: true, updatedAt: Date.now() };
    if (job.state === "queued") {
        update.state = "canceled";
        update.phase = "canceled";
        update.message = "Canceled before collection started.";
    } else {
        update.message = "Cancellation requested.";
    }
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update(update);
    return getStatus(firestore, uid, { id: job.id });
}

async function retryJob(firestore, uid, body, env, publish) {
    var job = await ownedJob(firestore, uid, body.id);
    if (job.state !== "failed" && job.state !== "canceled") {
        throw serviceError(409, "kindle-digest-retry", "Only failed or canceled jobs can be retried.");
    }
    var dispatchId = crypto.randomUUID();
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        dispatchId: dispatchId,
        workerDispatchId: null,
        state: "queued",
        phase: "queued",
        message: "Waiting for the digest worker.",
        cancelRequested: false,
        error: null,
        result: null,
        updatedAt: Date.now()
    });
    await publishJob(publish, env, { id: job.id, dispatchId: dispatchId });
    return getStatus(firestore, uid, { id: job.id });
}

async function syncOptions(firestore, body) {
    var raw = Array.isArray(body.sources) ? body.sources : [];
    if (!raw.length || raw.length > 50) throw serviceError(400, "kindle-digest-sources", "Worker sources are invalid.");
    var sources = raw.map(validateSource);
    var now = Date.now();
    await firestore.doc(CONFIG_DOCUMENT).set({ sources: sources, updatedAt: now, lastSeenAt: now }, { merge: true });
    return { ok: true };
}

async function pullJob(firestore) {
    await touchWorker(firestore);
    var jobs = (await listJobs(firestore)).filter(function (job) { return job.state === "queued"; });
    jobs.sort(function (left, right) { return Number(left.createdAt || 0) - Number(right.createdAt || 0); });
    var job = jobs[0];
    if (!job) return { job: null };
    return {
        job: {
            id: job.id,
            mode: "digest",
            url: job.sourceUrl,
            lookbackDays: job.lookbackDays,
            importantOnly: job.importantOnly === true,
            articleLimit: job.articleLimit,
            allSources: job.allSources === true
        }
    };
}

async function claimJob(firestore, body) {
    await touchWorker(firestore);
    var job = await jobById(firestore, body.id);
    var dispatchId = validateId(body.dispatchId);
    if (job.dispatchId !== dispatchId) return { job: null };
    if (job.state !== "queued" && !(job.state === "running" && job.workerDispatchId === dispatchId)) {
        return { job: null };
    }
    if (job.state === "queued") {
        await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
            state: "running",
            workerDispatchId: dispatchId,
            updatedAt: Date.now()
        });
    }
    return {
        job: {
            id: job.id,
            mode: "digest",
            url: job.sourceUrl,
            lookbackDays: job.lookbackDays,
            importantOnly: job.importantOnly === true,
            articleLimit: job.articleLimit,
            allSources: job.allSources === true
        }
    };
}

function publishJob(publish, env, job) {
    return publish({
        env: env,
        queueUrl: env.KINDLE_DIGEST_QUEUE_URL,
        groupId: "kindle-digest",
        id: job.id,
        dispatchId: job.dispatchId
    });
}

async function updateProgress(firestore, body) {
    var id = validateId(body.id);
    var phase = String(body.phase || "");
    if (!WORKER_PHASES[phase]) throw serviceError(400, "kindle-digest-phase", "Worker phase is invalid.");
    var job = await jobById(firestore, id);
    if (TERMINAL_STATES[job.state]) return { cancelRequested: job.cancelRequested === true || job.state === "canceled" };
    var update = {
        state: "running",
        phase: phase,
        message: cleanText(body.message, 500) || "Digest worker is running.",
        updatedAt: Date.now()
    };
    if (body.current !== undefined) update.current = boundedInteger(body.current, 0, 10000, "current");
    if (body.total !== undefined) update.total = boundedInteger(body.total, 0, 10000, "total");
    await firestore.collection(JOBS_COLLECTION).doc(id).update(update);
    return { cancelRequested: job.cancelRequested === true };
}

async function checkJob(firestore, body) {
    await touchWorker(firestore);
    var job = await jobById(firestore, body.id);
    return { cancelRequested: job.cancelRequested === true || job.state === "canceled", state: job.state };
}

async function finishJob(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (TERMINAL_STATES[job.state]) {
        return { ok: true, cancelRequested: job.cancelRequested === true || job.state === "canceled" };
    }
    if (job.cancelRequested || job.state === "canceled") return { cancelRequested: true };
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "sent",
        phase: "sent",
        message: cleanText(body.message, 500) || "Digest was sent to Kindle.",
        result: sanitizeResult(body.result),
        updatedAt: Date.now()
    });
    return { ok: true, cancelRequested: false };
}

async function failJob(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (TERMINAL_STATES[job.state]) return { ok: true };
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "failed",
        phase: "failed",
        message: "Digest failed.",
        error: cleanText(body.error, 1000) || "The digest worker failed.",
        updatedAt: Date.now()
    });
    return { ok: true };
}

async function cancelFromWorker(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (TERMINAL_STATES[job.state]) return { ok: true };
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "canceled",
        phase: "canceled",
        message: "Digest was canceled.",
        cancelRequested: true,
        updatedAt: Date.now()
    });
    return { ok: true };
}

async function touchWorker(firestore) {
    await firestore.doc(CONFIG_DOCUMENT).set({ lastSeenAt: Date.now() }, { merge: true });
}

async function ownedJob(firestore, uid, id) {
    var job = await jobById(firestore, id);
    if (job.uid !== uid) throw serviceError(404, "kindle-digest-job", "Digest job was not found.");
    return job;
}

async function jobById(firestore, value) {
    var id = validateId(value);
    var snapshot = await firestore.collection(JOBS_COLLECTION).doc(id).get();
    if (!snapshot.exists) throw serviceError(404, "kindle-digest-job", "Digest job was not found.");
    return Object.assign({ id: id }, snapshot.data() || {});
}

async function listJobs(firestore) {
    // ponytail: this is a single-owner service; add indexed pagination with multi-user delivery.
    var snapshot = await firestore.collection(JOBS_COLLECTION).limit(50).get();
    return snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data() || {}); });
}

function publicJob(job) {
    return {
        id: job.id,
        mode: job.mode,
        sourceId: job.sourceId,
        sourceLabel: job.sourceLabel,
        lookbackDays: job.lookbackDays,
        importantOnly: job.importantOnly === true,
        articleLimit: job.articleLimit === undefined ? null : job.articleLimit,
        state: job.state,
        phase: job.phase,
        message: job.message || "",
        current: job.current === undefined ? null : job.current,
        total: job.total === undefined ? null : job.total,
        error: job.error || null,
        result: job.result || null,
        createdAt: Number(job.createdAt || 0),
        updatedAt: Number(job.updatedAt || 0)
    };
}

function publicSource(source) {
    return { id: source.id, label: source.label };
}

function validateSource(value) {
    value = value || {};
    var id = String(value.id || "").trim();
    var label = cleanText(value.label, 100);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !label) {
        throw serviceError(400, "kindle-digest-sources", "Worker sources are invalid.");
    }
    return { id: id, label: label, url: validatePublicHttpUrl(value.url) };
}

function validatePublicHttpUrl(value) {
    var url;
    try { url = new URL(String(value || "")); }
    catch (error) { throw serviceError(400, "kindle-digest-url", "Enter a valid HTTP or HTTPS source URL."); }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        throw serviceError(400, "kindle-digest-url", "Enter a valid HTTP or HTTPS source URL.");
    }
    if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) {
        throw serviceError(400, "kindle-digest-url", "Custom source URLs cannot use nonstandard ports.");
    }
    return url.toString();
}

function boundedInteger(value, minimum, maximum, name) {
    var number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw serviceError(400, "kindle-digest-input", name + " must be an integer from " + minimum + " to " + maximum + ".");
    }
    return number;
}

function sanitizeResult(value) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
        articleCount: Math.max(0, Number(value.articleCount || 0)),
        fileCount: Math.max(0, Number(value.fileCount || 0)),
        sizeBytes: Math.max(0, Number(value.sizeBytes || 0)),
        delivery: ["email", "send-to-kindle", "local"].indexOf(String(value.delivery || "")) !== -1 ? String(value.delivery) : "local"
    };
}

function cleanText(value, maximum) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function validateId(value) {
    var id = String(value || "");
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw serviceError(400, "kindle-digest-job", "Digest job ID is invalid.");
    return id;
}

function newestFirst(left, right) {
    return Number(right.createdAt || 0) - Number(left.createdAt || 0);
}

function requireAllowedUser(uid, env) {
    var allowed = String(env.KINDLE_DIGEST_ALLOWED_UIDS || "").split(",").map(function (value) { return value.trim(); }).filter(Boolean);
    if (!uid || allowed.indexOf(uid) === -1) throw serviceError(403, "kindle-digest-forbidden", "Kindle Digest is not enabled for this account.");
}

function requireWorker(value, env) {
    var expected = String(env.KINDLE_DIGEST_WORKER_SECRET || "");
    var actual = String(value || "").replace(/^Bearer\s+/i, "");
    var expectedBytes = Buffer.from(expected);
    var actualBytes = Buffer.from(actual);
    if (!expected || expectedBytes.length !== actualBytes.length || !crypto.timingSafeEqual(expectedBytes, actualBytes)) {
        throw serviceError(401, "kindle-digest-worker-auth", "Digest worker authentication failed.");
    }
}

function serviceError(status, code, message) {
    var error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

module.exports = { handle: handle, testHooks: { validatePublicHttpUrl: validatePublicHttpUrl } };
