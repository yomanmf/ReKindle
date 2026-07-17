"use strict";

var crypto = require("node:crypto");

var SESSION_COLLECTION = "microsoft_todo_sessions";
var MICROSOFT_SCOPE = "offline_access Tasks.ReadWrite";
var GRAPH_BASE = "https://graph.microsoft.com/v1.0";
var TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
var REQUEST_TIMEOUT_MS = 20000;
var MAX_COLLECTION_PAGES = 5;

async function handle(options) {
    options = options || {};
    var action = String(options.action || "");
    var body = options.body || {};
    var uid = String(options.uid || "");
    var firestore = options.firestore;
    var env = options.env || process.env;

    if (!uid || !firestore) throw serviceError(500, "microsoft-todo-internal", "Microsoft To Do storage is not available.");
    var doc = firestore.collection(SESSION_COLLECTION).doc(uid);

    if (action === "status") return getStatus(doc, uid, env);
    if (action === "start") return startAuthorization(doc, uid, env);
    if (action === "poll") return pollAuthorization(doc, uid, env);
    if (action === "logout") return logOut(doc);
    if (action === "lists") return withAccessToken(doc, uid, env, listTaskLists);
    if (action === "create-list") return withAccessToken(doc, uid, env, function (token) {
        return createTaskList(token, body);
    });
    if (action === "tasks") return withAccessToken(doc, uid, env, function (token) {
        return listTasks(token, body);
    });
    if (action === "create") return withAccessToken(doc, uid, env, function (token) {
        return createTask(token, body);
    });
    if (action === "update") return withAccessToken(doc, uid, env, function (token) {
        return updateTask(token, body);
    });
    if (action === "delete") return withAccessToken(doc, uid, env, function (token) {
        return deleteTask(token, body);
    });
    throw serviceError(404, "microsoft-todo-action-not-found", "Microsoft To Do action was not found.");
}

async function getStatus(doc, uid, env) {
    var snapshot = await readSessionDocument(doc);
    if (!snapshot.exists) return { authorized: false, stage: "start" };
    var data = snapshot.data() || {};
    var key = getEncryptionKey(env);

    if (data.session) {
        try {
            var session = decryptObject(data.session, key, sessionAad(uid));
            if (!session.refreshToken) throw new Error("Missing refresh token.");
            return { authorized: true, stage: "connected" };
        } catch (error) {
            await doc.delete();
            return { authorized: false, stage: "start" };
        }
    }

    if (!data.pending) return { authorized: false, stage: "start" };
    try {
        var pending = decryptObject(data.pending, key, pendingAad(uid));
        if (Number(pending.expiresAt || 0) <= Date.now()) {
            await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
            return { authorized: false, stage: "start" };
        }
        return pendingResponse(pending);
    } catch (error) {
        await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
        return { authorized: false, stage: "start" };
    }
}

async function startAuthorization(doc, uid, env) {
    var clientId = getClientId(env);
    var form = new URLSearchParams();
    form.set("client_id", clientId);
    form.set("scope", MICROSOFT_SCOPE);
    var result = await microsoftRequest(identityBase(env) + "/devicecode", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
    });

    if (result.status !== 200) throw identityError(result, "Microsoft could not start device authorization.");
    var payload = result.body || {};
    var expiresIn = clampInteger(payload.expires_in, 60, 1800, 900);
    var interval = clampInteger(payload.interval, 5, 30, 5);
    var verificationUri = validateVerificationUri(payload.verification_uri || payload.verification_url);
    var pending = {
        deviceCode: validateOpaqueToken(payload.device_code, "device code"),
        userCode: validateUserCode(payload.user_code),
        verificationUri: verificationUri,
        expiresAt: Date.now() + expiresIn * 1000,
        intervalMs: interval * 1000,
        nextPollAt: Date.now() + interval * 1000,
        createdAt: Date.now()
    };
    await doc.set({
        pending: encryptObject(pending, getEncryptionKey(env), pendingAad(uid)),
        session: null,
        updatedAt: Date.now()
    }, { merge: true });
    return pendingResponse(pending);
}

async function pollAuthorization(doc, uid, env) {
    var context = await loadPending(doc, uid, env);
    var pending = context.pending;
    var now = Date.now();
    if (pending.expiresAt <= now) {
        await doc.set({ pending: null, updatedAt: now }, { merge: true });
        throw serviceError(409, "microsoft-todo-auth-expired", "The Microsoft sign-in code expired. Start again.");
    }
    if (Number(pending.nextPollAt || 0) > now) return pendingResponse(pending);

    var form = new URLSearchParams();
    form.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
    form.set("client_id", getClientId(env));
    form.set("device_code", pending.deviceCode);
    var result = await microsoftRequest(identityBase(env) + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
    });

    if (result.status === 200) {
        var token = normalizeTokenResponse(result.body);
        await doc.set({
            pending: null,
            session: encryptObject(token, getEncryptionKey(env), sessionAad(uid)),
            connectedAt: Date.now(),
            updatedAt: Date.now()
        }, { merge: true });
        return { authorized: true, stage: "connected" };
    }

    var code = String(result.body && result.body.error || "");
    if (code === "authorization_pending" || code === "slow_down") {
        if (code === "slow_down") pending.intervalMs = Math.min(30000, Number(pending.intervalMs || 5000) + 5000);
        pending.nextPollAt = Date.now() + Number(pending.intervalMs || 5000);
        await savePending(doc, uid, pending, env);
        return pendingResponse(pending);
    }
    if (code === "expired_token") {
        await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
        throw serviceError(409, "microsoft-todo-auth-expired", "The Microsoft sign-in code expired. Start again.");
    }
    if (code === "authorization_declined" || code === "access_denied") {
        await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
        throw serviceError(403, "microsoft-todo-auth-declined", "Microsoft sign-in was cancelled.");
    }
    throw identityError(result, "Microsoft sign-in could not be completed.");
}

async function listTaskLists(token) {
    var url = GRAPH_BASE + "/me/todo/lists?$select=id,displayName,isOwner,isShared,wellknownListName&$top=100";
    var items = await graphCollection(token, url);
    return { lists: items.map(sanitizeTaskList).filter(Boolean) };
}

async function createTaskList(token, body) {
    var displayName = validateTitle(body.displayName, "list name");
    var result = await graphRequest(token, GRAPH_BASE + "/me/todo/lists", {
        method: "POST",
        body: { displayName: displayName }
    });
    if (result.status !== 201) throw graphError(result);
    return { list: sanitizeTaskList(result.body) };
}

async function listTasks(token, body) {
    var listId = validateGraphId(body.listId, "list ID");
    var url = GRAPH_BASE + "/me/todo/lists/" + encodeURIComponent(listId) +
        "/tasks?$select=id,title,status,importance,dueDateTime,body,createdDateTime,lastModifiedDateTime&$top=100";
    var items = await graphCollection(token, url);
    return { tasks: items.map(sanitizeTask).filter(Boolean) };
}

async function createTask(token, body) {
    var listId = validateGraphId(body.listId, "list ID");
    var requestBody = {
        title: validateTitle(body.title, "task title"),
        importance: validateImportance(body.importance || "normal")
    };
    var dueDate = validateOptionalDate(body.dueDate);
    var notes = validateOptionalNotes(body.notes);
    if (dueDate) requestBody.dueDateTime = graphDate(dueDate);
    if (notes) requestBody.body = { content: notes, contentType: "text" };

    var result = await graphRequest(token, GRAPH_BASE + "/me/todo/lists/" + encodeURIComponent(listId) + "/tasks", {
        method: "POST",
        body: requestBody
    });
    if (result.status !== 201) throw graphError(result);
    return { task: sanitizeTask(result.body) };
}

async function updateTask(token, body) {
    var listId = validateGraphId(body.listId, "list ID");
    var taskId = validateGraphId(body.taskId, "task ID");
    var requestBody = {};

    if (body.title !== undefined) requestBody.title = validateTitle(body.title, "task title");
    if (body.status !== undefined) requestBody.status = validateStatus(body.status);
    if (body.importance !== undefined) requestBody.importance = validateImportance(body.importance);
    if (body.notes !== undefined) requestBody.body = { content: validateOptionalNotes(body.notes), contentType: "text" };
    if (body.dueDate !== undefined) {
        var dueDate = validateOptionalDate(body.dueDate);
        requestBody.dueDateTime = dueDate ? graphDate(dueDate) : null;
    }
    if (!Object.keys(requestBody).length) throw serviceError(400, "microsoft-todo-invalid-task", "No task changes were provided.");

    var result = await graphRequest(token, GRAPH_BASE + "/me/todo/lists/" + encodeURIComponent(listId) +
        "/tasks/" + encodeURIComponent(taskId), { method: "PATCH", body: requestBody });
    if (result.status !== 200) throw graphError(result);
    return { task: sanitizeTask(result.body) };
}

async function deleteTask(token, body) {
    var listId = validateGraphId(body.listId, "list ID");
    var taskId = validateGraphId(body.taskId, "task ID");
    var result = await graphRequest(token, GRAPH_BASE + "/me/todo/lists/" + encodeURIComponent(listId) +
        "/tasks/" + encodeURIComponent(taskId), { method: "DELETE" });
    if (result.status !== 204) throw graphError(result);
    return { deleted: true };
}

async function withAccessToken(doc, uid, env, operation) {
    var snapshot = await readSessionDocument(doc);
    var data = snapshot.exists ? snapshot.data() || {} : {};
    if (!data.session) throw serviceError(401, "microsoft-todo-not-connected", "Connect Microsoft To Do first.");
    var key = getEncryptionKey(env);
    var session;
    try {
        session = decryptObject(data.session, key, sessionAad(uid));
    } catch (error) {
        await doc.delete();
        throw serviceError(409, "microsoft-todo-session-expired", "The Microsoft To Do session is no longer valid. Connect again.");
    }

    if (!session.accessToken || !session.refreshToken || Number(session.expiresAt || 0) <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
        session = await refreshAccessToken(session, env);
        await saveSession(doc, uid, session, env);
    }

    try {
        return await operation(session.accessToken);
    } catch (error) {
        if (error && error.code === "microsoft-todo-provider-auth") {
            session = await refreshAccessToken(session, env);
            await saveSession(doc, uid, session, env);
            return operation(session.accessToken);
        }
        throw error;
    }
}

async function refreshAccessToken(session, env) {
    if (!session.refreshToken) throw serviceError(409, "microsoft-todo-session-expired", "The Microsoft To Do session expired. Connect again.");
    var form = new URLSearchParams();
    form.set("client_id", getClientId(env));
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", session.refreshToken);
    form.set("scope", MICROSOFT_SCOPE);
    var result = await microsoftRequest(identityBase(env) + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
    });
    if (result.status !== 200) {
        var code = String(result.body && result.body.error || "");
        if (code === "invalid_grant" || code === "interaction_required") {
            throw serviceError(409, "microsoft-todo-session-expired", "The Microsoft To Do session expired. Connect again.");
        }
        throw identityError(result, "Microsoft could not refresh the To Do session.");
    }
    var refreshed = normalizeTokenResponse(result.body, session.refreshToken);
    return refreshed;
}

async function graphCollection(token, initialUrl) {
    var url = initialUrl;
    var items = [];
    for (var page = 0; page < MAX_COLLECTION_PAGES && url; page++) {
        validateGraphUrl(url);
        var result = await graphRequest(token, url, { method: "GET" });
        if (result.status !== 200) throw graphError(result);
        var values = Array.isArray(result.body && result.body.value) ? result.body.value : [];
        items = items.concat(values);
        url = result.body && result.body["@odata.nextLink"] || "";
    }
    return items.slice(0, 500);
}

async function graphRequest(token, url, options) {
    options = options || {};
    validateGraphUrl(url);
    var headers = {
        "Accept": "application/json",
        "Authorization": "Bearer " + token
    };
    var request = { method: options.method || "GET", headers: headers };
    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        request.body = JSON.stringify(options.body);
    }
    return microsoftRequest(url, request);
}

async function microsoftRequest(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
        var response = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
        var text = await response.text();
        var body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch (error) {
            body = { error: { message: "Microsoft returned an invalid response." } };
        }
        return { status: response.status, body: body };
    } catch (error) {
        if (error && error.name === "AbortError") throw serviceError(504, "microsoft-todo-timeout", "Microsoft did not respond in time.");
        throw serviceError(502, "microsoft-todo-unavailable", "Microsoft To Do is temporarily unavailable.");
    } finally {
        clearTimeout(timer);
    }
}

function graphError(result) {
    var status = Number(result.status || 502);
    var providerCode = String(result.body && result.body.error && result.body.error.code || "");
    if (status === 401 || status === 403 || providerCode === "InvalidAuthenticationToken") {
        return serviceError(401, "microsoft-todo-provider-auth", "Microsoft authorization needs to be refreshed.");
    }
    if (status === 404) return serviceError(404, "microsoft-todo-not-found", "The Microsoft To Do item was not found.");
    if (status === 429) return serviceError(429, "microsoft-todo-rate-limited", "Microsoft To Do is receiving too many requests. Try again soon.");
    if (status >= 500) return serviceError(503, "microsoft-todo-unavailable", "Microsoft To Do is temporarily unavailable.");
    var message = String(result.body && result.body.error && result.body.error.message || "Microsoft To Do rejected the request.");
    return serviceError(400, "microsoft-todo-provider-request", message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300));
}

function identityError(result, fallback) {
    var status = Number(result.status || 502);
    if (status === 429) return serviceError(429, "microsoft-todo-rate-limited", "Microsoft temporarily limited sign-in attempts.");
    if (status >= 500) return serviceError(503, "microsoft-todo-unavailable", "Microsoft sign-in is temporarily unavailable.");
    var code = String(result.body && result.body.error || "");
    if (code === "invalid_client" || code === "unauthorized_client") {
        return serviceError(503, "microsoft-todo-configuration", "Microsoft To Do integration is not configured correctly.");
    }
    return serviceError(400, "microsoft-todo-auth-failed", fallback);
}

function normalizeTokenResponse(body, fallbackRefreshToken) {
    body = body || {};
    var accessToken = validateOpaqueToken(body.access_token, "access token");
    var refreshToken = validateOpaqueToken(body.refresh_token || fallbackRefreshToken, "refresh token");
    var expiresIn = clampInteger(body.expires_in, 60, 86400, 3600);
    return {
        accessToken: accessToken,
        refreshToken: refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        scope: String(body.scope || MICROSOFT_SCOPE).slice(0, 500),
        tokenType: "Bearer"
    };
}

function sanitizeTaskList(value) {
    if (!value || !value.id) return null;
    return {
        id: String(value.id).slice(0, 512),
        displayName: String(value.displayName || "Tasks").slice(0, 255),
        isOwner: value.isOwner !== false,
        isShared: value.isShared === true,
        wellknownListName: String(value.wellknownListName || "none").slice(0, 50)
    };
}

function sanitizeTask(value) {
    if (!value || !value.id) return null;
    var due = value.dueDateTime || null;
    var body = value.body || {};
    return {
        id: String(value.id).slice(0, 512),
        title: String(value.title || "Untitled task").slice(0, 255),
        status: validateReturnedStatus(value.status),
        importance: value.importance === "high" || value.importance === "low" ? value.importance : "normal",
        dueDate: due && /^\d{4}-\d{2}-\d{2}/.test(String(due.dateTime || "")) ? String(due.dateTime).slice(0, 10) : "",
        notes: String(body.content || "").slice(0, 5000),
        createdDateTime: safeIso(value.createdDateTime),
        lastModifiedDateTime: safeIso(value.lastModifiedDateTime)
    };
}

function validateReturnedStatus(value) {
    var allowed = { notStarted: true, inProgress: true, completed: true, waitingOnOthers: true, deferred: true };
    return allowed[value] ? value : "notStarted";
}

function validateGraphUrl(value) {
    var parsed;
    try {
        parsed = new URL(String(value || ""));
    } catch (error) {
        throw serviceError(400, "microsoft-todo-invalid-path", "Invalid Microsoft Graph path.");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "graph.microsoft.com" || parsed.pathname.indexOf("/v1.0/me/todo/") !== 0) {
        throw serviceError(400, "microsoft-todo-invalid-path", "Invalid Microsoft Graph path.");
    }
    return parsed.toString();
}

function validateGraphId(value, label) {
    var id = String(value || "");
    if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) {
        throw serviceError(400, "microsoft-todo-invalid-id", "Invalid " + label + ".");
    }
    return id;
}

function validateTitle(value, label) {
    var text = String(value || "").trim();
    if (!text || text.length > 255 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        throw serviceError(400, "microsoft-todo-invalid-title", "Enter a valid " + label + ".");
    }
    return text;
}

function validateOptionalNotes(value) {
    var text = String(value || "");
    if (text.length > 5000 || /[\u0000\u000b\u000c]/.test(text)) {
        throw serviceError(400, "microsoft-todo-invalid-notes", "Task notes are too long or invalid.");
    }
    return text;
}

function validateOptionalDate(value) {
    var date = String(value || "").trim();
    if (!date) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw serviceError(400, "microsoft-todo-invalid-date", "Use YYYY-MM-DD for the due date.");
    var parts = date.split("-").map(Number);
    var parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() !== parts[1] - 1 || parsed.getUTCDate() !== parts[2]) {
        throw serviceError(400, "microsoft-todo-invalid-date", "Enter a valid due date.");
    }
    return date;
}

function validateStatus(value) {
    var allowed = { notStarted: true, inProgress: true, completed: true, waitingOnOthers: true, deferred: true };
    if (!allowed[value]) throw serviceError(400, "microsoft-todo-invalid-status", "Invalid task status.");
    return value;
}

function validateImportance(value) {
    var text = String(value || "normal");
    if (text !== "low" && text !== "normal" && text !== "high") {
        throw serviceError(400, "microsoft-todo-invalid-importance", "Invalid task importance.");
    }
    return text;
}

function graphDate(value) {
    return { dateTime: value + "T12:00:00.0000000", timeZone: "UTC" };
}

function safeIso(value) {
    var text = String(value || "");
    return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 40) : "";
}

async function loadPending(doc, uid, env) {
    var snapshot = await readSessionDocument(doc);
    var data = snapshot.exists ? snapshot.data() || {} : {};
    if (!data.pending) throw serviceError(409, "microsoft-todo-auth-expired", "Start Microsoft sign-in again.");
    var pending;
    try {
        pending = decryptObject(data.pending, getEncryptionKey(env), pendingAad(uid));
    } catch (error) {
        await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
        throw serviceError(409, "microsoft-todo-auth-expired", "Start Microsoft sign-in again.");
    }
    return { pending: pending };
}

async function savePending(doc, uid, pending, env) {
    await doc.set({
        pending: encryptObject(pending, getEncryptionKey(env), pendingAad(uid)),
        updatedAt: Date.now()
    }, { merge: true });
}

async function saveSession(doc, uid, session, env) {
    await doc.set({
        session: encryptObject(session, getEncryptionKey(env), sessionAad(uid)),
        updatedAt: Date.now()
    }, { merge: true });
}

async function readSessionDocument(doc) {
    try {
        return await doc.get();
    } catch (error) {
        throw serviceError(503, "microsoft-todo-storage-unavailable", "Microsoft To Do session storage is temporarily unavailable.");
    }
}

async function logOut(doc) {
    await doc.delete();
    return { authorized: false, stage: "start" };
}

function pendingResponse(pending) {
    return {
        authorized: false,
        stage: "code",
        userCode: String(pending.userCode || ""),
        verificationUri: String(pending.verificationUri || "https://microsoft.com/devicelogin"),
        expiresAt: Number(pending.expiresAt || 0),
        retryAfter: Math.max(1, Math.ceil((Number(pending.nextPollAt || 0) - Date.now()) / 1000))
    };
}

function identityBase(env) {
    var tenant = String(env.MICROSOFT_TODO_TENANT || "common").trim();
    if (!/^(common|organizations|consumers|[0-9a-fA-F-]{36})$/.test(tenant)) {
        throw serviceError(503, "microsoft-todo-configuration", "Microsoft To Do tenant configuration is invalid.");
    }
    return "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0";
}

function getClientId(env) {
    var value = String(env.MICROSOFT_TODO_CLIENT_ID || "").trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(value)) {
        throw serviceError(503, "microsoft-todo-configuration", "Microsoft To Do application is not configured.");
    }
    return value;
}

function getEncryptionKey(env) {
    var raw = String(env.MICROSOFT_TODO_SESSION_ENCRYPTION_KEY || "").trim();
    var key;
    try {
        key = Buffer.from(raw, "base64");
    } catch (error) {
        key = Buffer.alloc(0);
    }
    if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
        throw serviceError(503, "microsoft-todo-configuration", "Microsoft To Do session encryption is not configured.");
    }
    return key;
}

function validateVerificationUri(value) {
    var parsed;
    try {
        parsed = new URL(String(value || ""));
    } catch (error) {
        throw serviceError(502, "microsoft-todo-auth-failed", "Microsoft returned an invalid verification address.");
    }
    var allowed = parsed.hostname === "microsoft.com" || parsed.hostname === "www.microsoft.com" || parsed.hostname === "login.microsoftonline.com";
    if (parsed.protocol !== "https:" || !allowed || parsed.username || parsed.password) {
        throw serviceError(502, "microsoft-todo-auth-failed", "Microsoft returned an invalid verification address.");
    }
    return parsed.toString();
}

function validateUserCode(value) {
    var text = String(value || "").trim();
    if (!/^[A-Z0-9-]{4,20}$/i.test(text)) throw serviceError(502, "microsoft-todo-auth-failed", "Microsoft did not return a valid sign-in code.");
    return text;
}

function validateOpaqueToken(value, label) {
    var text = String(value || "");
    if (!text || text.length > 8192 || /[\u0000-\u001f\u007f]/.test(text)) {
        throw serviceError(502, "microsoft-todo-auth-failed", "Microsoft did not return a valid " + label + ".");
    }
    return text;
}

function clampInteger(value, min, max, fallback) {
    var number = Number(value);
    if (!Number.isInteger(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
}

function pendingAad(uid) {
    return "rekindle:microsoft-todo:pending:" + uid;
}

function sessionAad(uid) {
    return "rekindle:microsoft-todo:session:" + uid;
}

function encryptObject(value, key, aad) {
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(String(aad), "utf8"));
    var ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return {
        version: 1,
        iv: iv.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
    };
}

function decryptObject(value, key, aad) {
    if (!value || value.version !== 1) throw new Error("Unsupported encrypted value.");
    var decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(value.iv || ""), "base64"));
    decipher.setAAD(Buffer.from(String(aad), "utf8"));
    decipher.setAuthTag(Buffer.from(String(value.tag || ""), "base64"));
    var plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(value.ciphertext || ""), "base64")),
        decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext);
}

function serviceError(status, code, message) {
    var error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

module.exports = {
    handle: handle,
    testHooks: {
        encryptObject: encryptObject,
        decryptObject: decryptObject,
        getEncryptionKey: getEncryptionKey,
        validateGraphUrl: validateGraphUrl,
        validateGraphId: validateGraphId,
        validateOptionalDate: validateOptionalDate,
        sanitizeTask: sanitizeTask,
        pendingAad: pendingAad,
        sessionAad: sessionAad
    }
};
