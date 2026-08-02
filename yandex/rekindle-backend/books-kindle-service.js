"use strict";

var crypto = require("node:crypto");

var JOBS_COLLECTION = "books_kindle_jobs";
var SETTINGS_COLLECTION = "books_kindle_settings";
var CONFIG_DOCUMENT = "books_kindle_config/current";
var ACTIVE_STATES = { queued: true, running: true };
var TERMINAL_STATES = { ready: true, sent: true, failed: true, canceled: true };
var PHASES = { searching: true, downloading: true, converting: true, cover: true, sending: true };

async function handle(options) {
    options = options || {};
    var action = String(options.action || "");
    var body = options.body || {};
    var firestore = options.firestore;
    var env = options.env || process.env;
    if (!firestore) throw serviceError(500, "books-kindle-storage", "Books to Kindle storage is unavailable.");

    if (options.worker === true) {
        requireWorker(options.workerToken, env);
        if (action === "sync") return syncWorker(firestore, body);
        if (action === "pull") return pullJob(firestore);
        if (action === "progress") return updateProgress(firestore, body);
        if (action === "check") return checkJob(firestore, body);
        if (action === "search-results") return finishSearch(firestore, body);
        if (action === "finish") return finishDelivery(firestore, body);
        if (action === "fail") return failJob(firestore, body);
        if (action === "canceled") return cancelFromWorker(firestore, body);
        throw serviceError(404, "books-kindle-action", "Books to Kindle worker action was not found.");
    }

    var uid = String(options.uid || "");
    requireAllowedUser(uid, env);
    if (action === "kindle-status") return getKindleStatus(firestore, uid);
    if (action === "kindle-set") return setKindleEmail(firestore, uid, body);
    if (action === "kindle-forget") return forgetKindleEmail(firestore, uid);
    if (action === "search") return createSearch(firestore, uid, body);
    if (action === "create") return createDelivery(firestore, uid, body);
    if (action === "status") return getStatus(firestore, uid, body);
    if (action === "cancel") return cancelJob(firestore, uid, body);
    if (action === "retry") return retryJob(firestore, uid, body);
    throw serviceError(404, "books-kindle-action", "Books to Kindle action was not found.");
}

async function getKindleStatus(firestore, uid) {
    var snapshots = await Promise.all([
        firestore.collection(SETTINGS_COLLECTION).doc(uid).get(),
        firestore.doc(CONFIG_DOCUMENT).get()
    ]);
    var settings = snapshots[0].exists ? snapshots[0].data() || {} : {};
    var config = snapshots[1].exists ? snapshots[1].data() || {} : {};
    return {
        connected: Boolean(settings.kindleEmail),
        email: settings.kindleEmail || "",
        sender: config.sender || "",
        online: Number(config.lastSeenAt || 0) >= Date.now() - 120000
    };
}

async function setKindleEmail(firestore, uid, body) {
    var email = String(body.email || "").trim().toLowerCase();
    if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:free\.)?kindle\.com$/.test(email)) {
        throw serviceError(400, "books-kindle-email", "Enter a valid Send to Kindle address.");
    }
    await firestore.collection(SETTINGS_COLLECTION).doc(uid).set({ kindleEmail: email, updatedAt: Date.now() }, { merge: true });
    return getKindleStatus(firestore, uid);
}

async function forgetKindleEmail(firestore, uid) {
    await firestore.collection(SETTINGS_COLLECTION).doc(uid).set({ kindleEmail: null, updatedAt: Date.now() }, { merge: true });
    return getKindleStatus(firestore, uid);
}

async function createSearch(firestore, uid, body) {
    var query = cleanText(body.query, 160);
    if (query.length < 2) throw serviceError(400, "books-kindle-query", "Enter 2 to 160 characters.");
    var active = await activeJob(firestore, uid);
    if (active) return { job: publicJob(active), existing: true };
    var now = Date.now();
    var job = {
        id: crypto.randomUUID(),
        uid: uid,
        action: "search",
        query: query,
        state: "queued",
        phase: "queued",
        message: "Waiting for the books worker.",
        results: [],
        cancelRequested: false,
        createdAt: now,
        updatedAt: now
    };
    await firestore.collection(JOBS_COLLECTION).doc(job.id).set(job);
    return { job: publicJob(job), existing: false };
}

async function createDelivery(firestore, uid, body) {
    var job = await ownedJob(firestore, uid, body.id);
    if (job.state !== "ready" || !Array.isArray(job.results)) {
        throw serviceError(409, "books-kindle-selection", "Search for a book before sending it.");
    }
    var bookId = String(body.bookId || "");
    var book = job.results.find(function (candidate) { return candidate.id === bookId; });
    if (!book) throw serviceError(400, "books-kindle-selection", "Select a book from the search results.");
    var settings = await firestore.collection(SETTINGS_COLLECTION).doc(uid).get();
    var kindleEmail = settings.exists && (settings.data() || {}).kindleEmail;
    if (!kindleEmail) throw serviceError(409, "books-kindle-email", "Save your Send to Kindle address first.");

    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        action: "deliver",
        selectedBook: book,
        kindleEmail: kindleEmail,
        state: "queued",
        phase: "queued",
        message: "Waiting for the books worker.",
        cancelRequested: false,
        error: null,
        result: null,
        updatedAt: Date.now()
    });
    return getStatus(firestore, uid, { id: job.id });
}

async function getStatus(firestore, uid, body) {
    var jobs = (await listJobs(firestore)).filter(function (job) { return job.uid === uid; });
    var id = String(body.id || "");
    var job = id ? jobs.find(function (candidate) { return candidate.id === id; }) : jobs.sort(newestFirst)[0];
    return { job: job ? publicJob(job) : null };
}

async function cancelJob(firestore, uid, body) {
    var job = await ownedJob(firestore, uid, body.id);
    if (TERMINAL_STATES[job.state]) return { job: publicJob(job) };
    var update = { cancelRequested: true, message: "Cancellation requested.", updatedAt: Date.now() };
    if (job.state === "queued") {
        update.state = "canceled";
        update.phase = "canceled";
        update.message = "Canceled before processing started.";
    }
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update(update);
    return getStatus(firestore, uid, { id: job.id });
}

async function retryJob(firestore, uid, body) {
    var job = await ownedJob(firestore, uid, body.id);
    if (job.state !== "failed" && job.state !== "canceled") {
        throw serviceError(409, "books-kindle-retry", "Only failed or canceled jobs can be retried.");
    }
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        action: job.selectedBook ? "deliver" : "search",
        state: "queued",
        phase: "queued",
        message: "Waiting for the books worker.",
        cancelRequested: false,
        error: null,
        result: null,
        updatedAt: Date.now()
    });
    return getStatus(firestore, uid, { id: job.id });
}

async function syncWorker(firestore, body) {
    var sender = cleanText(body.sender, 254);
    if (!/^\S+@\S+$/.test(sender)) throw serviceError(400, "books-kindle-sender", "Worker sender is invalid.");
    await firestore.doc(CONFIG_DOCUMENT).set({ sender: sender, lastSeenAt: Date.now() }, { merge: true });
    return { ok: true };
}

async function pullJob(firestore) {
    await touchWorker(firestore);
    var jobs = (await listJobs(firestore)).filter(function (job) { return job.state === "queued"; });
    jobs.sort(function (left, right) { return Number(left.createdAt || 0) - Number(right.createdAt || 0); });
    var job = jobs[0];
    if (!job) return { job: null };
    if (job.action === "search") return { job: { id: job.id, action: "search", query: job.query } };
    return {
        job: {
            id: job.id,
            action: "deliver",
            book: job.selectedBook,
            kindleEmail: job.kindleEmail
        }
    };
}

async function updateProgress(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (job.cancelRequested || job.state === "canceled") return { cancelRequested: true };
    var phase = String(body.phase || "");
    if (!PHASES[phase]) throw serviceError(400, "books-kindle-phase", "Worker phase is invalid.");
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "running",
        phase: phase,
        message: cleanText(body.message, 500) || "Books worker is running.",
        updatedAt: Date.now()
    });
    return { cancelRequested: false };
}

async function checkJob(firestore, body) {
    await touchWorker(firestore);
    var job = await jobById(firestore, body.id);
    return { cancelRequested: job.cancelRequested === true || job.state === "canceled", state: job.state };
}

async function finishSearch(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (job.cancelRequested || job.state === "canceled") return { cancelRequested: true };
    var results = Array.isArray(body.results) ? body.results.slice(0, 20).map(validateWorkerBook) : [];
    var firstPageOnly = body.firstPageOnly === true && results.length === 0;
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "ready",
        phase: "ready",
        message: cleanText(body.message, 500) || (results.length ? "Choose a book." : "No books found."),
        results: results,
        firstPageOnly: firstPageOnly,
        updatedAt: Date.now()
    });
    return { ok: true, count: results.length };
}

async function finishDelivery(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (job.cancelRequested || job.state === "canceled") return { cancelRequested: true };
    var format = String(body.format || "");
    if (format !== "epub" && format !== "pdf") throw serviceError(400, "books-kindle-format", "Worker format is invalid.");
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "sent",
        phase: "sent",
        message: cleanText(body.message, 500) || "Book sent to Kindle.",
        result: { format: format },
        updatedAt: Date.now()
    });
    return { ok: true };
}

async function failJob(firestore, body) {
    var job = await jobById(firestore, body.id);
    if (TERMINAL_STATES[job.state]) return { ok: true };
    await firestore.collection(JOBS_COLLECTION).doc(job.id).update({
        state: "failed",
        phase: "failed",
        message: "Books to Kindle failed.",
        error: cleanText(body.error, 1000) || "Books worker failed.",
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
        message: "Books to Kindle was canceled.",
        cancelRequested: true,
        updatedAt: Date.now()
    });
    return { ok: true };
}

async function touchWorker(firestore) {
    await firestore.doc(CONFIG_DOCUMENT).set({ lastSeenAt: Date.now() }, { merge: true });
}

async function activeJob(firestore, uid) {
    return (await listJobs(firestore)).find(function (job) { return job.uid === uid && ACTIVE_STATES[job.state]; });
}

async function ownedJob(firestore, uid, id) {
    var job = await jobById(firestore, id);
    if (job.uid !== uid) throw serviceError(404, "books-kindle-job", "Books to Kindle job was not found.");
    return job;
}

async function jobById(firestore, value) {
    var id = validateId(value);
    var snapshot = await firestore.collection(JOBS_COLLECTION).doc(id).get();
    if (!snapshot.exists) throw serviceError(404, "books-kindle-job", "Books to Kindle job was not found.");
    return Object.assign({ id: id }, snapshot.data() || {});
}

async function listJobs(firestore) {
    // ponytail: one allowed owner; add indexed pagination if this becomes multi-user.
    var snapshot = await firestore.collection(JOBS_COLLECTION).limit(100).get();
    return snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data() || {}); });
}

function publicJob(job) {
    return {
        id: job.id,
        action: job.action,
        query: job.query || "",
        state: job.state,
        phase: job.phase,
        message: job.message || "",
        firstPageOnly: job.firstPageOnly === true,
        results: Array.isArray(job.results) ? job.results.map(publicBook) : [],
        selectedBook: job.selectedBook ? publicBook(job.selectedBook) : null,
        error: job.error || null,
        result: job.result || null,
        createdAt: Number(job.createdAt || 0),
        updatedAt: Number(job.updatedAt || 0)
    };
}

function publicBook(book) {
    var formats = [];
    if (book.epubUrl) formats.push("EPUB");
    if (book.fb2Url) formats.push("FB2");
    if (book.pdfUrl) formats.push("PDF");
    return { id: book.id, title: book.title, author: book.author, formats: formats };
}

function validateWorkerBook(value) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var book = {
        id: String(value.id || ""),
        title: cleanText(value.title, 300),
        author: cleanText(value.author, 300),
        pageUrl: workerUrl(value.pageUrl),
        epubUrl: optionalWorkerUrl(value.epubUrl),
        fb2Url: optionalWorkerUrl(value.fb2Url),
        pdfUrl: optionalWorkerUrl(value.pdfUrl)
    };
    if (!/^\d{1,20}$/.test(book.id) || !book.title || (!book.epubUrl && !book.fb2Url && !book.pdfUrl)) {
        throw serviceError(400, "books-kindle-results", "Worker book result is invalid.");
    }
    return book;
}

function optionalWorkerUrl(value) {
    return value ? workerUrl(value) : "";
}

function workerUrl(value) {
    var url;
    try { url = new URL(String(value || "")); }
    catch (error) { throw serviceError(400, "books-kindle-results", "Worker book URL is invalid."); }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.toString().length > 2000) {
        throw serviceError(400, "books-kindle-results", "Worker book URL is invalid.");
    }
    return url.toString();
}

function cleanText(value, maximum) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function validateId(value) {
    var id = String(value || "");
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw serviceError(400, "books-kindle-job", "Books to Kindle job ID is invalid.");
    return id;
}

function newestFirst(left, right) {
    return Number(right.createdAt || 0) - Number(left.createdAt || 0);
}

function requireAllowedUser(uid, env) {
    var configured = String(env.BOOKS_KINDLE_ALLOWED_UIDS || env.KINDLE_DIGEST_ALLOWED_UIDS || "");
    var allowed = configured.split(",").map(function (value) { return value.trim(); }).filter(Boolean);
    if (!uid || allowed.indexOf(uid) === -1) throw serviceError(403, "books-kindle-forbidden", "Books to Kindle is not enabled for this account.");
}

function requireWorker(value, env) {
    var expectedValue = String(env.BOOKS_KINDLE_WORKER_SECRET || env.KINDLE_DIGEST_WORKER_SECRET || "");
    var expected = Buffer.from("Bearer " + expectedValue);
    var actual = Buffer.from(String(value || ""));
    if (!expectedValue || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw serviceError(401, "books-kindle-worker-auth", "Books to Kindle worker authentication failed.");
    }
}

function serviceError(status, code, message) {
    var error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

module.exports = { handle: handle, testHooks: { validateWorkerBook: validateWorkerBook } };
