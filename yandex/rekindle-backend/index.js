"use strict";

var admin = require("firebase-admin");
var s3Package = require("@aws-sdk/client-s3");
var presignerPackage = require("@aws-sdk/s3-request-presigner");

var MAX_USER_STORAGE_BYTES = 100 * 1024 * 1024;
var MAX_OBJECT_BYTES = 25 * 1024 * 1024;
var SIGNED_URL_TTL_SECONDS = 300;
var FIREBASE_DATABASE_URL = "https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app";
var DEFAULT_ALLOWED_ORIGINS = [
    "https://rekindle.website.yandexcloud.net",
    "https://rekindle-fork.web.app",
    "https://rekindle-fork.firebaseapp.com"
];
var ALLOWED_FOLDERS = { files: true, photos: true };
var RESERVED_USERNAME = /(ukiyo|rekindle|wantban|root|system|admin|administrator|mod|moderator|support)/i;
var firebaseApp;
var s3Client;

module.exports.handler = async function (event) {
    event = event || {};
    var method = String(event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || "GET").toUpperCase();
    var path = normalizeRoute(event.path || (event.requestContext && event.requestContext.path) || "");
    var origin = getHeader(event, "origin");

    if (method === "OPTIONS") return response(204, "", origin);
    if (!isAllowedOrigin(origin)) return response(403, { error: "Origin is not allowed." }, origin);

    try {
        if (method === "GET" && endsWith(path, "/health")) {
            return response(200, { ok: true, service: "rekindle-backend" }, origin);
        }
        if (method === "POST" && endsWith(path, "/auth/register")) {
            return response(200, await registerUser(event), origin);
        }
        if (method === "POST" && endsWith(path, "/auth/check-ip")) {
            return response(200, await checkIpOnLogin(event), origin);
        }
        if (method === "GET" && endsWith(path, "/storage/list")) {
            return response(200, await listObjects(event), origin);
        }
        if (method === "POST" && endsWith(path, "/storage/upload-url")) {
            return response(200, await createUploadUrl(event), origin);
        }
        if (method === "POST" && endsWith(path, "/storage/download-url")) {
            return response(200, await createDownloadUrl(event), origin);
        }
        if (method === "DELETE" && endsWith(path, "/storage/object")) {
            return response(200, await deleteObject(event), origin);
        }
        return response(404, { error: "Endpoint not found." }, origin);
    } catch (error) {
        var normalized = normalizeError(error);
        console.error("ReKindle backend request failed", {
            path: path,
            status: normalized.status,
            code: normalized.code,
            message: normalized.message
        });
        return response(normalized.status, { error: normalized.message, code: normalized.code }, origin);
    }
};

async function registerUser(event) {
    var body = parseJsonBody(event);
    var username = String(body.username || "").trim();
    var password = String(body.password || "");
    var ip = getSourceIp(event);

    if (!username || !password) throw httpError(400, "invalid-argument", "Username and password are required.");
    if (username.length > 20) throw httpError(400, "invalid-argument", "Username must be 20 characters or less.");
    if (!/^[a-zA-Z0-9]+$/.test(username)) throw httpError(400, "invalid-argument", "Username can only contain letters and numbers.");
    if (RESERVED_USERNAME.test(username)) throw httpError(400, "invalid-argument", "Forbidden username.");
    if (password.length < 6) throw httpError(400, "weak-password", "Password must contain at least 6 characters.");

    var app = getFirebaseApp();
    var database = app.database();
    await enforceRegistrationRateLimit(database, ip);
    await ensureIpIsAllowed(database, ip);

    var email = username + "@rekindle.ink";
    var userRecord;
    try {
        userRecord = await app.auth().createUser({ email: email, password: password, displayName: username });
    } catch (error) {
        if (error.code === "auth/email-already-exists") {
            throw httpError(409, "already-exists", "That username is already taken.");
        }
        if (error.code === "auth/invalid-password") {
            throw httpError(400, "weak-password", "Password is too weak.");
        }
        throw error;
    }

    try {
        await ensureIpIsAllowed(database, ip);
        var avatarSeed = Math.floor(Math.random() * 10000);
        var updates = {};
        updates["users_private/" + userRecord.uid + "/ipAddress"] = ip || "unknown";
        updates["users_public/" + userRecord.uid] = {
            username: username,
            email: email,
            avatarSeed: avatarSeed,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            lastActive: admin.database.ServerValue.TIMESTAMP
        };
        updates["user_cards/" + userRecord.uid] = {
            username: username,
            avatarSeed: avatarSeed,
            customAvatar: null
        };
        await database.ref().update(updates);
        var customToken = await app.auth().createCustomToken(userRecord.uid);
        return { customToken: customToken };
    } catch (error) {
        await app.auth().deleteUser(userRecord.uid).catch(function () {});
        throw error;
    }
}

async function checkIpOnLogin(event) {
    var authContext = await requireFirebaseUser(event, false);
    var app = getFirebaseApp();
    var database = app.database();
    var ip = getSourceIp(event);
    var safeIp = sanitizeIp(ip);

    if (safeIp) {
        var banned = await database.ref("banned_ips/" + safeIp).once("value");
        if (banned.exists()) {
            await app.auth().updateUser(authContext.uid, { disabled: true });
            await app.auth().revokeRefreshTokens(authContext.uid);
            await database.ref("users_private/" + authContext.uid + "/ipAddress").set(ip);
            return { banned: true };
        }
        await database.ref("users_private/" + authContext.uid + "/ipAddress").set(ip);
    }
    return { banned: false };
}

async function listObjects(event) {
    var user = await requireFirebaseUser(event, true);
    var query = event.queryStringParameters || {};
    var folder = validateFolder(query.folder);
    var prefix = "users/" + user.uid + "/" + folder + "/";
    var client = getS3Client();
    var bucket = getRequiredEnv("S3_BUCKET");
    var continuationToken;
    var items = [];

    do {
        var result = await client.send(new s3Package.ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken
        }));
        var contents = result.Contents || [];
        for (var i = 0; i < contents.length; i++) {
            var object = contents[i];
            if (!object.Key || object.Key === prefix) continue;
            items.push({
                name: object.Key.slice(prefix.length),
                fullPath: object.Key,
                size: Number(object.Size || 0),
                contentType: guessContentType(object.Key),
                updated: object.LastModified ? new Date(object.LastModified).toISOString() : ""
            });
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
    } while (continuationToken);

    return { items: items };
}

async function createUploadUrl(event) {
    var user = await requireFirebaseUser(event, true);
    var body = parseJsonBody(event);
    var key = validateUserObjectPath(user.uid, body.path);
    var size = Number(body.size || 0);
    var contentType = sanitizeContentType(body.contentType);

    if (!size || size < 0 || size > MAX_OBJECT_BYTES) {
        throw httpError(400, "invalid-size", "File must be between 1 byte and 25 MB.");
    }
    await enforceStorageQuota(user.uid, key, size);

    var command = new s3Package.PutObjectCommand({
        Bucket: getRequiredEnv("S3_BUCKET"),
        Key: key,
        ContentType: contentType
    });
    var url = await presignerPackage.getSignedUrl(getS3Client(), command, { expiresIn: SIGNED_URL_TTL_SECONDS });
    return { url: url, path: key, contentType: contentType, expiresIn: SIGNED_URL_TTL_SECONDS };
}

async function createDownloadUrl(event) {
    var user = await requireFirebaseUser(event, true);
    var body = parseJsonBody(event);
    var key = validateUserObjectPath(user.uid, body.path);
    var input = { Bucket: getRequiredEnv("S3_BUCKET"), Key: key };
    if (body.download === true) input.ResponseContentDisposition = "attachment";
    var url = await presignerPackage.getSignedUrl(
        getS3Client(),
        new s3Package.GetObjectCommand(input),
        { expiresIn: SIGNED_URL_TTL_SECONDS }
    );
    return { url: url, expiresIn: SIGNED_URL_TTL_SECONDS };
}

async function deleteObject(event) {
    var user = await requireFirebaseUser(event, true);
    var body = parseJsonBody(event);
    var key = validateUserObjectPath(user.uid, body.path);
    await getS3Client().send(new s3Package.DeleteObjectCommand({
        Bucket: getRequiredEnv("S3_BUCKET"),
        Key: key
    }));
    return { deleted: true };
}

async function requireFirebaseUser(event, requirePro) {
    var token = getHeader(event, "x-firebase-token");
    if (!token) throw httpError(401, "unauthenticated", "Authentication is required.");
    var decoded;
    try {
        decoded = await getFirebaseApp().auth().verifyIdToken(token, true);
    } catch (error) {
        throw httpError(401, "unauthenticated", "Session is invalid or expired.");
    }
    var isDeveloper = decoded.email === "ukiyo@rekindle.ink";
    if (requirePro && decoded.pro !== true && !isDeveloper) {
        throw httpError(403, "pro-required", "ReKindle Pro is required for cloud files.");
    }
    return decoded;
}

async function enforceStorageQuota(uid, targetKey, incomingSize) {
    var total = 0;
    var existingSize = 0;
    var prefixes = ["users/" + uid + "/files/", "users/" + uid + "/photos/"];
    var client = getS3Client();
    var bucket = getRequiredEnv("S3_BUCKET");

    for (var p = 0; p < prefixes.length; p++) {
        var continuationToken;
        do {
            var page = await client.send(new s3Package.ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefixes[p],
                ContinuationToken: continuationToken
            }));
            var contents = page.Contents || [];
            for (var i = 0; i < contents.length; i++) {
                var size = Number(contents[i].Size || 0);
                total += size;
                if (contents[i].Key === targetKey) existingSize = size;
            }
            continuationToken = page.IsTruncated ? page.NextContinuationToken : null;
        } while (continuationToken);
    }
    if (total - existingSize + incomingSize > MAX_USER_STORAGE_BYTES) {
        throw httpError(413, "quota-exceeded", "The 100 MB cloud storage quota would be exceeded.");
    }
}

async function enforceRegistrationRateLimit(database, ip) {
    var safeIp = sanitizeIp(ip) || "unknown";
    var now = Date.now();
    var windowMs = 60 * 60 * 1000;
    var allowed = false;
    await database.ref("auth_rate_limits/register/" + safeIp).transaction(function (current) {
        allowed = false;
        current = current || { count: 0, windowStartedAt: now };
        if (!current.windowStartedAt || now - current.windowStartedAt >= windowMs) {
            current = { count: 0, windowStartedAt: now };
        }
        if (current.count >= 5) return;
        allowed = true;
        current.count += 1;
        current.updatedAt = now;
        return current;
    });
    if (!allowed) throw httpError(429, "rate-limited", "Too many registration attempts. Please try again later.");
}

async function ensureIpIsAllowed(database, ip) {
    var safeIp = sanitizeIp(ip);
    if (!safeIp) return;
    var snapshot = await database.ref("banned_ips/" + safeIp).once("value");
    if (snapshot.exists()) throw httpError(403, "ip-banned", "Registration is not available from your network.");
}

function getFirebaseApp() {
    if (firebaseApp) return firebaseApp;
    var serviceAccountRaw = getRequiredEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
    var serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountRaw);
    } catch (error) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: FIREBASE_DATABASE_URL,
        projectId: "rekindle-fork"
    }, "rekindle-yandex-backend");
    return firebaseApp;
}

function getS3Client() {
    if (s3Client) return s3Client;
    s3Client = new s3Package.S3Client({
        region: "ru-central1",
        endpoint: "https://storage.yandexcloud.net",
        credentials: {
            accessKeyId: getRequiredEnv("S3_ACCESS_KEY_ID"),
            secretAccessKey: getRequiredEnv("S3_SECRET_ACCESS_KEY")
        }
    });
    return s3Client;
}

function validateFolder(folder) {
    folder = String(folder || "");
    if (!ALLOWED_FOLDERS[folder]) throw httpError(400, "invalid-folder", "Folder must be files or photos.");
    return folder;
}

function validateUserObjectPath(uid, value) {
    var path = String(value || "").replace(/^\/+/, "");
    if (path.indexOf("\\") !== -1 || path.indexOf("..") !== -1 || path.indexOf("//") !== -1) {
        throw httpError(400, "invalid-path", "Invalid object path.");
    }
    var prefix = "users/" + uid + "/";
    if (path.indexOf(prefix) !== 0) throw httpError(403, "forbidden", "Object path does not belong to this user.");
    var rest = path.slice(prefix.length);
    var slash = rest.indexOf("/");
    var folder = slash === -1 ? "" : rest.slice(0, slash);
    var name = slash === -1 ? "" : rest.slice(slash + 1);
    validateFolder(folder);
    if (!name || name.length > 180 || name.indexOf("/") !== -1 || /[\u0000-\u001f]/.test(name)) {
        throw httpError(400, "invalid-path", "Invalid file name.");
    }
    return prefix + folder + "/" + name;
}

function sanitizeContentType(value) {
    var type = String(value || "application/octet-stream").toLowerCase();
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) return "application/octet-stream";
    return type.slice(0, 100);
}

function guessContentType(key) {
    var lower = String(key || "").toLowerCase();
    if (endsWith(lower, ".jpg") || endsWith(lower, ".jpeg")) return "image/jpeg";
    if (endsWith(lower, ".png")) return "image/png";
    if (endsWith(lower, ".gif")) return "image/gif";
    if (endsWith(lower, ".webp")) return "image/webp";
    if (endsWith(lower, ".svg")) return "image/svg+xml";
    if (endsWith(lower, ".json")) return "application/json";
    if (endsWith(lower, ".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (endsWith(lower, ".doc")) return "application/msword";
    return "application/octet-stream";
}

function parseJsonBody(event) {
    var raw = event.body || "{}";
    if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
    if (typeof raw === "object") return raw;
    try {
        return JSON.parse(raw || "{}");
    } catch (error) {
        throw httpError(400, "invalid-json", "Request body must be valid JSON.");
    }
}

function getSourceIp(event) {
    var contextIp = event.requestContext && event.requestContext.identity && event.requestContext.identity.sourceIp;
    var ip = String(contextIp || "").trim();
    if (!ip) {
        var forwarded = getHeader(event, "x-forwarded-for");
        ip = String(forwarded || "").split(",")[0].trim();
    }
    return ip.replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
}

function sanitizeIp(ip) {
    ip = String(ip || "").trim();
    if (!ip) return "";
    return ip.replace(/\./g, "-").replace(/:/g, "_").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
}

function getHeader(event, name) {
    var headers = event.headers || {};
    var target = String(name || "").toLowerCase();
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === target) return headers[keys[i]];
    }
    return "";
}

function getAllowedOrigins() {
    var configured = String(process.env.ALLOWED_ORIGINS || "").split(",").map(function (value) {
        return value.trim();
    }).filter(Boolean);
    return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function isAllowedOrigin(origin) {
    if (!origin) return true;
    return getAllowedOrigins().indexOf(origin) !== -1;
}

function normalizeRoute(path) {
    path = String(path || "");
    if (!path) return "/";
    return path.split("?")[0].replace(/\/+$/, "") || "/";
}

function response(statusCode, body, origin) {
    var allowedOrigin = isAllowedOrigin(origin) && origin ? origin : DEFAULT_ALLOWED_ORIGINS[0];
    return {
        statusCode: statusCode,
        headers: {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Firebase-Token",
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "Vary": "Origin"
        },
        isBase64Encoded: false,
        body: typeof body === "string" ? body : JSON.stringify(body)
    };
}

function httpError(status, code, message) {
    var error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function normalizeError(error) {
    if (error && error.status) return error;
    return {
        status: 500,
        code: "internal",
        message: "The server could not complete the request."
    };
}

function getRequiredEnv(name) {
    var value = process.env[name];
    if (!value) throw new Error(name + " is not configured.");
    return value;
}

function endsWith(value, suffix) {
    value = String(value || "");
    return value.slice(-suffix.length) === suffix;
}
