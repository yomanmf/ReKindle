"use strict";

var admin = require("firebase-admin");
var s3Package = require("@aws-sdk/client-s3");
var presignerPackage = require("@aws-sdk/s3-request-presigner");
var ImapFlow;
var simpleParser;
var nodemailer;
var Readability;
var parseHTML;
var dns = require("node:dns").promises;
var net = require("node:net");
var crypto = require("node:crypto");
var nrlParser = require("./nrl");

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
var socialFirebaseApp;
var s3Client;
var nrlCache = { expiresAt: 0, body: null };

module.exports.handler = async function (event, context) {
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
        if (method === "POST" && endsWith(path, "/integrations/pinterest/oauth")) {
            return upstreamResponse(await pinterestExchangeCode(event), origin);
        }
        if (method === "POST" && endsWith(path, "/integrations/pinterest/refresh")) {
            return upstreamResponse(await pinterestRefreshToken(event), origin);
        }
        if (path.indexOf("/integrations/pinterest/api/") !== -1 &&
            (method === "GET" || method === "POST" || method === "DELETE")) {
            return upstreamResponse(await pinterestApiProxy(event, path, method), origin);
        }
        if (path.indexOf("/integrations/substack/api/") !== -1 &&
            (method === "GET" || method === "POST")) {
            return upstreamResponse(await substackApiProxy(event, path, method), origin);
        }
        if (method === "GET" && path.indexOf("/integrations/readwise/") !== -1) {
            return upstreamResponse(await readwiseApiProxy(event, path), origin);
        }
        if (method === "GET" && path.indexOf("/content/tmdb/") !== -1) {
            return upstreamResponse(await tmdbApiProxy(event, path), origin);
        }
        if (method === "GET" && endsWith(path, "/content/chords")) {
            return upstreamResponse(await chordsApiProxy(event), origin);
        }
        if ((method === "GET" || method === "HEAD") && endsWith(path, "/content/proxy")) {
            return await publicContentProxy(event, method, origin);
        }
        if ((method === "GET" || method === "HEAD") && endsWith(path, "/content/nrl-scores")) {
            return await nrlScoresProxy(event, method, origin);
        }
        if (method === "GET" && (endsWith(path, "/content/reader") || endsWith(path, "/content/reader/search"))) {
            return response(200, await readerContentProxy(event, path), origin);
        }
        if (method === "POST" && path.indexOf("/games/akinator/") !== -1) {
            return response(200, await akinatorProxy(event, path), origin);
        }
        if (method === "POST" && endsWith(path, "/billing/checkout")) {
            return response(200, await createStripeCheckout(event), origin);
        }
        if (method === "POST" && endsWith(path, "/billing/webhook")) {
            return response(200, await handleStripeWebhook(event), origin);
        }
        if (method === "POST" && endsWith(path, "/ai/chat")) {
            return response(200, await aiChat(event, context || {}), origin);
        }
        if (method === "POST" && endsWith(path, "/ai/ocr")) {
            return response(200, await recognizeImageText(event, context || {}), origin);
        }
        if (method === "POST" && path.indexOf("/mail/") !== -1) {
            return response(200, await handleMailRequest(event, path), origin);
        }
        if (method === "POST" && endsWith(path, "/reports/submit")) {
            return response(200, await createPrimarySuggestionReport(event), origin);
        }
        if (method === "POST" && endsWith(path, "/social/flipbook")) {
            return response(200, await postFlipbook(event), origin);
        }
        if (method === "POST" && endsWith(path, "/social/moderate")) {
            return response(200, await moderateAndPostSocial(event), origin);
        }
        if (method === "POST" && endsWith(path, "/social/translate")) {
            return response(200, await translateSocialContent(event, context || {}), origin);
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
        var errorBody = { error: normalized.message, code: normalized.code };
        if (normalized.retryAfter) errorBody.retryAfter = normalized.retryAfter;
        return response(normalized.status, errorBody, origin);
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
    var user = await requireFirebaseUser(event, false);
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
    var user = await requireFirebaseUser(event, false);
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
    var user = await requireFirebaseUser(event, false);
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
    var user = await requireFirebaseUser(event, false);
    var body = parseJsonBody(event);
    var key = validateUserObjectPath(user.uid, body.path);
    await getS3Client().send(new s3Package.DeleteObjectCommand({
        Bucket: getRequiredEnv("S3_BUCKET"),
        Key: key
    }));
    return { deleted: true };
}

async function pinterestExchangeCode(event) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "pinterest_oauth", 10, 60 * 60 * 1000);
    var body = parseJsonBody(event);
    var code = String(body.code || "");
    var redirectUri = validateRedirectUri(body.redirect_uri, "pinterest");
    if (!code) throw httpError(400, "invalid-argument", "Missing authorization code.");

    return pinterestTokenRequest({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri
    });
}

async function pinterestRefreshToken(event) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "pinterest_refresh", 20, 60 * 60 * 1000);
    var body = parseJsonBody(event);
    var refreshToken = String(body.refresh_token || "");
    if (!refreshToken) throw httpError(400, "invalid-argument", "Missing refresh token.");
    return pinterestTokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function pinterestTokenRequest(fields) {
    var clientId = getRequiredEnv("PINTEREST_CLIENT_ID");
    var clientSecret = getRequiredEnv("PINTEREST_CLIENT_SECRET");
    var form = new URLSearchParams();
    Object.keys(fields).forEach(function (key) { form.append(key, fields[key]); });
    var upstream = await fetch("https://api.pinterest.com/v5/oauth/token", {
        method: "POST",
        headers: {
            "Authorization": "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
    });
    return readUpstreamResponse(upstream);
}

async function pinterestApiProxy(event, path, method) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "pinterest_api", 120, 60 * 1000);
    var authHeader = getHeader(event, "authorization");
    if (!/^Bearer\s+\S+$/i.test(authHeader)) {
        throw httpError(401, "missing-provider-token", "Pinterest authorization is required.");
    }
    var marker = "/integrations/pinterest/api";
    var apiPath = path.slice(path.indexOf(marker) + marker.length);
    if (!apiPath || apiPath.indexOf("..") !== -1) throw httpError(400, "invalid-path", "Invalid Pinterest API path.");
    var url = new URL("https://api.pinterest.com/v5" + apiPath);
    appendQueryParameters(url, event.queryStringParameters || {});
    var options = {
        method: method,
        headers: { "Authorization": authHeader, "Content-Type": "application/json" }
    };
    if (method === "POST") options.body = JSON.stringify(parseJsonBody(event));
    return readUpstreamResponse(await fetch(url.toString(), options));
}

async function substackApiProxy(event, path, method) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "substack_api", 120, 60 * 1000);
    var marker = "/integrations/substack/api/";
    var apiPath = path.slice(path.indexOf(marker) + marker.length);
    if (!apiPath || apiPath.indexOf("..") !== -1) throw httpError(400, "invalid-path", "Invalid Substack API path.");
    var targetDomain = validateSubstackDomain(getHeader(event, "x-substack-target") || "substack.com");
    var url = new URL("https://" + targetDomain + "/api/v1/" + apiPath);
    appendQueryParameters(url, event.queryStringParameters || {});
    var headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ReKindle/1.0"
    };
    var sid = getHeader(event, "x-substack-sid");
    if (sid) headers.Cookie = "substack.sid=" + sid.replace(/[\r\n;]/g, "");
    var options = { method: method, headers: headers };
    if (method === "POST") options.body = JSON.stringify(parseJsonBody(event));
    return readUpstreamResponse(await fetch(url.toString(), options));
}

async function aiChat(event, context) {
    var user = await requireFirebaseUser(event, false);
    var body = parseJsonBody(event);
    var action = String(body.action || "chat");
    var hasUserKey = Boolean(body.apiKey);

    if (action === "list_models") {
        await enforceUserWindowRateLimit(user.uid, "ai_models", 30, 60 * 1000);
        if (!hasUserKey) throw httpError(400, "missing-api-key", "An API key is required to list provider models.");
        return listProviderModels(body);
    }

    var prompt = String(body.prompt || "").trim();
    if (!prompt) throw httpError(400, "invalid-argument", "No prompt provided.");
    if (prompt.length > 12000) throw httpError(413, "prompt-too-large", "Prompt is too long.");

    if (hasUserKey) {
        await enforceUserWindowRateLimit(user.uid, "ai_byok", 60, 60 * 1000);
        return generateWithUserProvider(body, prompt);
    }

    await enforceDailyLimit(user.uid, "ai_shared", 10);
    return generateWithYandex(context, prompt);
}

async function generateWithYandex(context, prompt) {
    var token = getYandexIamToken(context);
    var folderId = String(process.env.YANDEX_FOLDER_ID || context.functionFolderId || "");
    if (!folderId) throw new Error("YANDEX_FOLDER_ID is not configured.");
    var upstream = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "x-folder-id": folderId,
            "x-data-logging-enabled": "false"
        },
        body: JSON.stringify({
            modelUri: "gpt://" + folderId + "/yandexgpt-lite/latest",
            completionOptions: { stream: false, temperature: 0.3, maxTokens: "500" },
            messages: [{ role: "user", text: prompt }]
        })
    });
    var result = await readUpstreamResponse(upstream);
    if (result.status < 200 || result.status >= 300) throw upstreamError(result, "Yandex AI request failed.");
    var alternatives = result.body && result.body.result && result.body.result.alternatives;
    var text = alternatives && alternatives[0] && alternatives[0].message && alternatives[0].message.text;
    if (!text) throw httpError(502, "empty-ai-response", "AI provider returned an empty response.");
    return { text: String(text) };
}

async function listProviderModels(body) {
    var provider = String(body.provider || "openai");
    var apiKey = String(body.apiKey || "");
    if (provider === "gemini") {
        var geminiBase = validateProviderEndpoint(body.endpoint, "gemini");
        var geminiResult = await readUpstreamResponse(await fetch(
            geminiBase + "/v1beta/models?key=" + encodeURIComponent(apiKey)
        ));
        if (geminiResult.status < 200 || geminiResult.status >= 300) throw upstreamError(geminiResult, "Gemini model request failed.");
        return {
            models: (geminiResult.body.models || []).filter(function (model) {
                return model.supportedGenerationMethods && model.supportedGenerationMethods.indexOf("generateContent") !== -1;
            }).map(function (model) {
                var id = String(model.name || "").replace(/^models\//, "");
                return { id: id, name: model.displayName || id };
            })
        };
    }

    var base = validateProviderEndpoint(body.endpoint, "openai");
    var result = await readUpstreamResponse(await fetch(openAiApiUrl(base, "/models"), {
        headers: { "Authorization": "Bearer " + apiKey, "Accept": "application/json" }
    }));
    if (result.status < 200 || result.status >= 300) throw upstreamError(result, "Model request failed.");
    return {
        models: (result.body.data || []).map(function (model) {
            return { id: model.id, name: model.id };
        }).filter(function (model) { return Boolean(model.id); })
    };
}

async function generateWithUserProvider(body, prompt) {
    var provider = String(body.provider || "openai");
    var apiKey = String(body.apiKey || "");
    var model = String(body.model || "");
    if (provider === "gemini") {
        var geminiBase = validateProviderEndpoint(body.endpoint, "gemini");
        var geminiModel = model || "gemini-2.5-flash";
        if (!/^[a-zA-Z0-9._-]+$/.test(geminiModel)) throw httpError(400, "invalid-model", "Invalid model name.");
        var geminiResult = await readUpstreamResponse(await fetch(
            geminiBase + "/v1beta/models/" + encodeURIComponent(geminiModel) + ":generateContent?key=" + encodeURIComponent(apiKey),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            }
        ));
        if (geminiResult.status < 200 || geminiResult.status >= 300) throw upstreamError(geminiResult, "Gemini request failed.");
        var candidate = geminiResult.body.candidates && geminiResult.body.candidates[0];
        var parts = candidate && candidate.content && candidate.content.parts;
        var geminiText = parts && parts[0] && parts[0].text;
        if (!geminiText) throw httpError(502, "empty-ai-response", "AI provider returned an empty response.");
        return { text: String(geminiText) };
    }

    var base = validateProviderEndpoint(body.endpoint, "openai");
    var requestedModel = model || "gpt-4o-mini";
    var requestBody = {
        model: requestedModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500
    };
    if (requestedModel.indexOf("o1-") === 0) {
        delete requestBody.max_tokens;
        requestBody.max_completion_tokens = 2000;
    }
    var result = await readUpstreamResponse(await fetch(openAiApiUrl(base, "/chat/completions"), {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
    }));
    if (result.status < 200 || result.status >= 300) throw upstreamError(result, "AI provider request failed.");
    var choice = result.body.choices && result.body.choices[0];
    var text = choice && choice.message && choice.message.content;
    if (!text) throw httpError(502, "empty-ai-response", "AI provider returned an empty response.");
    return { text: String(text) };
}

async function recognizeImageText(event, context) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "ocr", 30, 60 * 60 * 1000);
    var body = parseJsonBody(event);
    var image = String(body.image || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    var mimeType = String(body.mimeType || "PNG").toUpperCase();
    if (mimeType !== "PNG" && mimeType !== "JPEG") {
        throw httpError(400, "invalid-argument", "OCR mimeType must be PNG or JPEG.");
    }
    if (!image) throw httpError(400, "invalid-argument", "No image provided.");
    if (!/^[a-zA-Z0-9+/=]+$/.test(image) || image.length > 8 * 1024 * 1024) {
        throw httpError(413, "image-too-large", "OCR image is invalid or too large.");
    }
    var token = getYandexIamToken(context);
    var folderId = String(process.env.YANDEX_FOLDER_ID || context.functionFolderId || "");
    if (!folderId) throw new Error("YANDEX_FOLDER_ID is not configured.");
    var upstream = await fetch("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "x-folder-id": folderId,
            "x-data-logging-enabled": "false"
        },
        body: JSON.stringify({ mimeType: mimeType, languageCodes: ["*"], model: "line", content: image })
    });
    var result = await readUpstreamResponse(upstream);
    if (result.status < 200 || result.status >= 300) throw upstreamError(result, "OCR request failed.");
    var lines = [];
    (result.body.result || []).forEach(function (page) {
        (page.blocks || []).forEach(function (block) {
            (block.lines || []).forEach(function (line) {
                if (line.text) lines.push(String(line.text));
            });
        });
    });
    return { text: lines.join(" ").trim() };
}

async function tmdbApiProxy(event, path) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "tmdb", 120, 60 * 60 * 1000);
    var marker = "/content/tmdb/";
    var apiPath = path.slice(path.indexOf(marker) + marker.length);
    if (!/^(search\/multi|tv\/\d+(\/season\/\d+)?|movie\/\d+)$/.test(apiPath)) {
        throw httpError(404, "not-found", "TMDB route is not allowed.");
    }
    var target = new URL("https://api.themoviedb.org/3/" + apiPath);
    appendQueryParameters(target, event.queryStringParameters || {});
    target.searchParams.set("api_key", getRequiredEnv("TMDB_API_KEY"));
    target.searchParams.set("include_adult", "false");
    var result = await readUpstreamResponse(await fetch(target.toString(), {
        headers: { "Accept": "application/json", "User-Agent": "ReKindle-Yandex/1.0" }
    }));
    if (result.status < 200 || result.status >= 300) throw upstreamError(result, "TMDB request failed.");
    return result;
}

async function chordsApiProxy(event) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "chords", 120, 60 * 60 * 1000);
    var query = event.queryStringParameters || {};
    var cmd = String(query.cmd || "search");
    var headers = { "User-Agent": "Mozilla/5.0 ReKindle-Yandex/1.0", "Accept": "text/html" };
    if (cmd === "search") {
        var term = String(query.q || "").trim();
        if (!term || term.length > 100) throw httpError(400, "invalid-query", "A search query is required.");
        var searchUrl = "https://www.guitaretab.com/fetch/?type=tab&query=" + encodeURIComponent(term);
        var searchResponse = await fetch(searchUrl, { headers: headers });
        if (!searchResponse.ok) throw httpError(502, "upstream-error", "Chord search failed.");
        var html = await searchResponse.text();
        var results = [];
        var linkRegex = /<a[^>]+href=["'](\/[a-z0-9]\/[^"']+\/[^"']+\.html)["'][^>]*class=["']gt-link[^"']*gt-link--primary[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
        var match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 50) {
            results.push({
                title: stripHtml(match[2]).trim(),
                artist: "Unknown",
                url: "https://www.guitaretab.com" + match[1],
                source: "GuitareTab"
            });
        }
        return { status: 200, body: results };
    }
    if (cmd === "get") {
        var target;
        try { target = new URL(String(query.url || "")); } catch (error) {
            throw httpError(400, "invalid-target", "Invalid chord URL.");
        }
        if (target.protocol !== "https:" || (target.hostname !== "guitaretab.com" && !endsWith(target.hostname, ".guitaretab.com"))) {
            throw httpError(400, "invalid-target", "Chord URL is not allowed.");
        }
        target.search = "";
        target.hash = "";
        var pageResponse = await fetch(target.toString(), { headers: headers });
        if (!pageResponse.ok) throw httpError(502, "upstream-error", "Chord page failed.");
        var pageHtml = await pageResponse.text();
        var contentMatch = pageHtml.match(/<section[^>]+class=["'][^"']*js-tab[^"']*["'][^>]*>([\s\S]*?)<\/section>/i) ||
            pageHtml.match(/<pre[^>]+class=["'][^"']*js-tab-content[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i);
        var content = contentMatch ? stripHtml(contentMatch[1]) : "";
        if (!content.trim()) throw httpError(422, "parse-failed", "Could not parse chord content.");
        return { status: 200, body: { content: content, source: target.toString() } };
    }
    throw httpError(400, "invalid-command", "Invalid chord command.");
}

async function readwiseApiProxy(event, path) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "readwise", 180, 60 * 60 * 1000);
    var token = String(getHeader(event, "x-readwise-token") || "").trim();
    if (!token || token.length > 500 || /[\r\n]/.test(token)) {
        throw httpError(400, "missing-token", "A valid Readwise token is required.");
    }
    var route = path.slice(path.lastIndexOf("/") + 1);
    var targets = {
        reader: "https://readwise.io/api/v3/list/",
        highlights: "https://readwise.io/api/v2/export/",
        review: "https://readwise.io/api/v2/review/",
        auth: "https://readwise.io/api/v2/auth/"
    };
    if (!targets[route]) throw httpError(404, "not-found", "Readwise route is not allowed.");
    var target = new URL(targets[route]);
    if (route === "reader" || route === "highlights") appendQueryParameters(target, event.queryStringParameters || {});
    var upstream = await fetch(target.toString(), {
        headers: { "Authorization": "Token " + token, "Accept": "application/json", "User-Agent": "ReKindle-Yandex/1.0" }
    });
    if (upstream.status === 204) return { status: 204, body: "" };
    var result = await readUpstreamResponse(upstream);
    return result;
}

function stripHtml(value) {
    return String(value || "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<[^>]*>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function readerContentProxy(event, path) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "reader", 120, 60 * 60 * 1000);
    var query = event.queryStringParameters || {};
    loadReaderLibraries();
    if (endsWith(path, "/search")) {
        var term = String(query.q || "").trim();
        if (!term || term.length > 150) throw httpError(400, "invalid-query", "A search query is required.");
        var searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(term);
        var searchHtml = await safeFetchHtml(searchUrl, {
            method: "POST",
            headers: {
                "User-Agent": "Mozilla/5.0 ReKindle-Yandex/1.0",
                "Accept": "text/html",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "q=" + encodeURIComponent(term)
        }, 2 * 1024 * 1024);
        var searchDocument = parseHTML(searchHtml.body).document;
        var nodes = searchDocument.querySelectorAll(".result");
        var results = [];
        for (var i = 0; i < nodes.length && results.length < 25; i++) {
            var titleLink = nodes[i].querySelector(".result__a");
            if (!titleLink) continue;
            var title = String(titleLink.textContent || "").trim();
            var href = String(titleLink.getAttribute("href") || "");
            if (href.indexOf("uddg=") !== -1) {
                try { href = new URL(href, "https://duckduckgo.com").searchParams.get("uddg") || href; } catch (ignore) {}
            }
            if (!/^https?:\/\//i.test(href) || !title) continue;
            var snippetNode = nodes[i].querySelector(".result__snippet");
            results.push({ title: title, url: href, snippet: String(snippetNode ? snippetNode.textContent : "").trim().slice(0, 300) });
        }
        return { query: term, results: results };
    }

    var targetUrl = String(query.url || "");
    if (!targetUrl) throw httpError(400, "invalid-target", "An article URL is required.");
    var fetched = await safeFetchHtml(targetUrl, {
        method: "GET",
        headers: {
            "User-Agent": "Mozilla/5.0 ReKindle-Yandex/1.0",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.5"
        }
    }, 3 * 1024 * 1024);
    var parsed = parseHTML(fetched.body);
    var document = parsed.document;
    var base = document.createElement("base");
    base.href = fetched.url;
    if (document.head) document.head.appendChild(base);
    var article = new Readability(document).parse();
    if (!article) {
        var bodyText = document.body ? String(document.body.textContent || "") : "";
        return {
            title: document.title || fetched.url,
            content: "<p>" + escapeHtmlText(bodyText.slice(0, 5000)) + "</p>",
            textContent: bodyText.slice(0, 5000),
            byline: null,
            siteName: null,
            excerpt: null,
            fallback: true
        };
    }
    return {
        title: article.title,
        content: String(article.content || "").slice(0, 1500000),
        textContent: String(article.textContent || "").slice(0, 1500000),
        byline: article.byline,
        siteName: article.siteName,
        excerpt: article.excerpt
    };
}

async function publicContentProxy(event, method, origin) {
    var query = event.queryStringParameters || {};
    var targetValue = String(query.url || "");
    if (!targetValue) throw httpError(400, "invalid-target", "A target URL is required.");
    var target = await validatePublicHttpUrl(targetValue);
    await enforcePublicIpRateLimit(event, "content_proxy", 300, 60 * 60 * 1000);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    var upstream;
    try {
        upstream = await fetch(target.toString(), {
            method: method,
            redirect: "manual",
            signal: controller.signal,
            headers: {
                "User-Agent": "ReKindle-Yandex/1.0 (https://rekindle.website.yandexcloud.net)",
                "Accept": String(getHeader(event, "accept") || "*/*").slice(0, 500)
            }
        });
    } finally {
        clearTimeout(timer);
    }
    if (upstream.status >= 300 && upstream.status < 400) {
        var redirects = Number(event.requestContext && event.requestContext.proxyRedirects || 0);
        if (redirects >= 5) throw httpError(502, "too-many-redirects", "Proxy target redirected too many times.");
        var location = upstream.headers.get("location");
        if (!location) throw httpError(502, "upstream-error", "Proxy redirect is invalid.");
        var redirected = await validatePublicHttpUrl(new URL(location, target).toString());
        return publicContentProxy(Object.assign({}, event, {
            queryStringParameters: Object.assign({}, query, { url: redirected.toString() }),
            requestContext: Object.assign({}, event.requestContext || {}, { skipProxyRateLimit: true, proxyRedirects: redirects + 1 })
        }), method, origin);
    }
    var contentType = String(upstream.headers.get("content-type") || "application/octet-stream").slice(0, 200);
    if (method === "HEAD") return rawResponse(upstream.status, Buffer.alloc(0), origin, contentType, 60);
    var bytes = await readLimitedResponseBytes(upstream, 5 * 1024 * 1024);
    return rawResponse(upstream.status, bytes, origin, contentType, 60);
}

async function nrlScoresProxy(event, method, origin) {
    await enforcePublicIpRateLimit(event, "nrl_scores", 120, 60 * 60 * 1000);
    if (nrlCache.body && nrlCache.expiresAt > Date.now()) {
        return rawResponse(200, method === "HEAD" ? Buffer.alloc(0) : nrlCache.body, origin, "application/json; charset=utf-8", 120);
    }
    var upstream = await fetch("https://www.espn.com/nrl/scoreboard", {
        headers: {
            "User-Agent": "ReKindle-Yandex/1.0 (https://rekindle.website.yandexcloud.net)",
            "Accept": "text/html,application/xhtml+xml"
        }
    });
    if (!upstream.ok) throw httpError(502, "upstream-error", "NRL source returned HTTP " + upstream.status + ".");
    var html = (await readLimitedResponseBytes(upstream, 4 * 1024 * 1024)).toString("utf8");
    var body = Buffer.from(JSON.stringify({ events: nrlParser.parseNRLScoreboard(html) }), "utf8");
    nrlCache = { expiresAt: Date.now() + 120000, body: body };
    return rawResponse(200, method === "HEAD" ? Buffer.alloc(0) : body, origin, "application/json; charset=utf-8", 120);
}

async function readLimitedResponseBytes(upstream, maxBytes) {
    var length = Number(upstream.headers.get("content-length") || 0);
    if (length > maxBytes) throw httpError(413, "response-too-large", "Upstream response is too large.");
    if (!upstream.body) return Buffer.alloc(0);
    var reader = upstream.body.getReader();
    var chunks = [];
    var total = 0;
    while (true) {
        var part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw httpError(413, "response-too-large", "Upstream response is too large.");
        }
        chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks, total);
}

function loadReaderLibraries() {
    if (Readability && parseHTML) return;
    Readability = require("@mozilla/readability").Readability;
    parseHTML = require("linkedom").parseHTML;
}

async function safeFetchHtml(value, options, maxBytes) {
    var current = await validatePublicHttpUrl(value);
    for (var redirect = 0; redirect < 5; redirect++) {
        var fetchOptions = Object.assign({}, options || {}, { redirect: "manual" });
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 15000);
        fetchOptions.signal = controller.signal;
        var upstream;
        try { upstream = await fetch(current.toString(), fetchOptions); } finally { clearTimeout(timer); }
        if (upstream.status >= 300 && upstream.status < 400) {
            var location = upstream.headers.get("location");
            if (!location) throw httpError(502, "upstream-error", "Article redirect is invalid.");
            current = await validatePublicHttpUrl(new URL(location, current).toString());
            if (fetchOptions.method === "POST" && (upstream.status === 301 || upstream.status === 302 || upstream.status === 303)) {
                options = { method: "GET", headers: options.headers };
            }
            continue;
        }
        if (!upstream.ok) throw httpError(502, "upstream-error", "Article source returned HTTP " + upstream.status + ".");
        var contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
        if (contentType && contentType.indexOf("text/html") === -1 && contentType.indexOf("application/xhtml+xml") === -1) {
            throw httpError(415, "invalid-content-type", "The requested URL is not an HTML page.");
        }
        var body = await upstream.text();
        if (Buffer.byteLength(body, "utf8") > maxBytes) throw httpError(413, "response-too-large", "The article is too large to process.");
        return { body: body, url: current.toString() };
    }
    throw httpError(502, "too-many-redirects", "The article redirected too many times.");
}

async function validatePublicHttpUrl(value) {
    var parsed;
    try { parsed = new URL(String(value || "")); } catch (error) {
        throw httpError(400, "invalid-target", "Invalid target URL.");
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
        throw httpError(400, "invalid-target", "Target URL is not allowed.");
    }
    if (parsed.hostname === "localhost" || endsWith(parsed.hostname, ".local")) {
        throw httpError(400, "invalid-target", "Target URL is not allowed.");
    }
    var addresses;
    try { addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true }); } catch (error) {
        throw httpError(400, "invalid-target", "Target host could not be resolved.");
    }
    if (!addresses.length || addresses.some(function (entry) { return isPrivateAddress(entry.address); })) {
        throw httpError(400, "invalid-target", "Target URL resolves to a private network.");
    }
    parsed.hash = "";
    return parsed;
}

function escapeHtmlText(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function akinatorProxy(event, path) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "akinator", 180, 60 * 60 * 1000);
    var body = parseJsonBody(event);
    var region = String(body.region || "en");
    var regionParts = region.split("_");
    var languages = { en: true, ar: true, cn: true, de: true, es: true, fr: true, il: true, it: true, jp: true, kr: true, nl: true, pl: true, pt: true, ru: true, tr: true, id: true };
    var themes = { "": true, objects: true, animals: true };
    if (!languages[regionParts[0]] || !themes[regionParts[1] || ""] || regionParts.length > 2) {
        throw httpError(400, "invalid-region", "Akinator region is not supported.");
    }
    var baseUrl = "https://" + regionParts[0] + ".akinator.com";
    var sid = regionParts[1] === "objects" ? 2 : (regionParts[1] === "animals" ? 14 : 1);
    var childMode = body.childMode === true;
    var action = path.slice(path.lastIndexOf("/") + 1);
    var upstreamPath;
    var form;
    if (action === "start") {
        upstreamPath = "/game";
        form = buildFormBody({ cm: childMode ? "true" : "false", sid: sid });
    } else if (action === "answer" || action === "back" || action === "continue") {
        if (typeof body.step === "undefined" || typeof body.progression === "undefined" || !body.session || !body.signature) {
            throw httpError(400, "invalid-argument", "Missing Akinator session parameters.");
        }
        if (action === "answer" && typeof body.answer === "undefined") {
            throw httpError(400, "invalid-argument", "Missing Akinator answer.");
        }
        upstreamPath = action === "answer" ? "/answer" : (action === "back" ? "/cancel_answer" : "/exclude");
        var params = {
            step: body.step,
            progression: body.progression,
            sid: sid,
            cm: childMode ? "true" : "false",
            session: String(body.session).slice(0, 500),
            signature: String(body.signature).slice(0, 500)
        };
        if (action === "answer") {
            params.answer = body.answer;
            params.step_last_proposition = String(body.stepLast || "").slice(0, 200);
        }
        form = buildFormBody(params);
    } else {
        throw httpError(404, "not-found", "Unknown Akinator action.");
    }
    var upstream = await fetch(baseUrl + upstreamPath, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 ReKindle-Yandex/1.0",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "text/html,application/json"
        },
        body: form
    });
    if (!upstream.ok) throw httpError(502, "upstream-error", "Akinator returned HTTP " + upstream.status + ".");
    var text = await upstream.text();
    if (action !== "start") {
        try { return JSON.parse(text); } catch (error) {
            throw httpError(502, "parse-failed", "Akinator returned an invalid response.");
        }
    }
    var session = extractFirstMatch(text, [/session:\s*'([^']+)'/, /id=["']session["'][^>]*value=["']([^"']+)["']/i]);
    var signature = extractFirstMatch(text, [/signature:\s*'([^']+)'/, /id=["']signature["'][^>]*value=["']([^"']+)["']/i]);
    var question = extractFirstMatch(text, [/<p[^>]*class=["'][^"']*question-text[^"']*["'][^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\/p>/i, /<[^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\//i]);
    if (!session || !signature || !question) throw httpError(502, "parse-failed", "Could not parse Akinator session.");
    var ids = ["a_yes", "a_no", "a_dont_know", "a_probably", "a_probaly_not"];
    var answers = ids.map(function (id, index) {
        var regex = new RegExp("<a[^>]*id=[\\\"']" + id + "[\\\"'][^>]*onclick=[\\\"']chooseAnswer\\(" + index + "\\)[\\\"'][^>]*>([\\s\\S]*?)<\\/a>", "i");
        var match = text.match(regex);
        return match && match[1] ? match[1].trim() : null;
    });
    return { session: session, signature: signature, question: question.trim(), baseUrl: baseUrl, sid: sid, region: region, answers: answers };
}

function buildFormBody(params) {
    return Object.keys(params).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    }).join("&");
}

function extractFirstMatch(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
        var match = text.match(patterns[i]);
        if (match && match[1]) return match[1];
    }
    return null;
}

async function createStripeCheckout(event) {
    var user = await requireFirebaseUser(event, false);
    await enforceUserWindowRateLimit(user.uid, "billing_checkout", 10, 60 * 60 * 1000);
    var body = parseJsonBody(event);
    var plan = String(body.plan || "");
    var priceIds = {
        monthly: process.env.STRIPE_PRICE_MONTHLY,
        yearly: process.env.STRIPE_PRICE_YEARLY,
        lifetime: process.env.STRIPE_PRICE_LIFETIME
    };
    if (!priceIds[plan]) throw httpError(400, "invalid-plan", "Invalid supporter plan.");
    var successUrl = validateBillingReturnUrl(body.success_url, true);
    var cancelUrl = validateBillingReturnUrl(body.cancel_url, false);
    var params = buildFormBody({
        client_reference_id: user.uid,
        mode: plan === "lifetime" ? "payment" : "subscription",
        "line_items[0][price]": priceIds[plan],
        "line_items[0][quantity]": "1",
        allow_promotion_codes: "true",
        success_url: successUrl,
        cancel_url: cancelUrl
    });
    var result = await readUpstreamResponse(await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + getRequiredEnv("STRIPE_KEY"),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
    }));
    if (result.status < 200 || result.status >= 300 || !result.body.url) {
        throw upstreamError(result, "Stripe checkout creation failed.");
    }
    return { url: result.body.url };
}

async function handleStripeWebhook(event) {
    var raw = event.body || "";
    if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 1024 * 1024) {
        throw httpError(400, "invalid-webhook", "Invalid Stripe webhook body.");
    }
    verifyStripeWebhookSignature(getHeader(event, "stripe-signature"), raw, getRequiredEnv("STRIPE_WEBHOOK_SECRET"));
    var stripeEvent;
    try { stripeEvent = JSON.parse(raw); } catch (error) {
        throw httpError(400, "invalid-webhook", "Stripe webhook is not valid JSON.");
    }
    var object = stripeEvent.data && stripeEvent.data.object;
    if (!object) return { received: true };
    if (stripeEvent.type === "checkout.session.completed" && object.client_reference_id) {
        var lifetime = object.mode === "payment";
        await setSupporterStatus(object.client_reference_id, {
            active: true,
            expiresAt: Date.now() + (lifetime ? 36500 : 32) * 24 * 60 * 60 * 1000,
            stripeCustomerId: object.customer || "",
            subscriptionType: lifetime ? "lifetime" : "recurring"
        });
    } else if (stripeEvent.type === "invoice.payment_succeeded" && object.customer) {
        var invoiceEnd = object.lines && object.lines.data && object.lines.data[0] && object.lines.data[0].period && object.lines.data[0].period.end;
        if (invoiceEnd) await updateSupporterByCustomer(object.customer, true, invoiceEnd * 1000 + 2 * 24 * 60 * 60 * 1000);
    } else if (stripeEvent.type === "customer.subscription.updated" && object.customer) {
        var periodEnd = object.current_period_end || (object.items && object.items.data && object.items.data[0] && object.items.data[0].current_period_end);
        if (object.status === "active" || object.status === "trialing") {
            if (periodEnd) await updateSupporterByCustomer(object.customer, true, periodEnd * 1000 + 2 * 24 * 60 * 60 * 1000);
        } else if (object.status === "past_due" || object.status === "unpaid") {
            await updateSupporterByCustomer(object.customer, false, Date.now());
        }
    } else if ((stripeEvent.type === "customer.subscription.deleted" || stripeEvent.type === "charge.refunded") && object.customer) {
        await updateSupporterByCustomer(object.customer, false, Date.now());
    }
    return { received: true };
}

function validateBillingReturnUrl(value, success) {
    var parsed;
    try { parsed = new URL(String(value || "")); } catch (error) {
        throw httpError(400, "invalid-return-url", "Invalid billing return URL.");
    }
    if (getAllowedOrigins().indexOf(parsed.origin) === -1) throw httpError(400, "invalid-return-url", "Billing return origin is not allowed.");
    var page = parsed.pathname.split("/").pop().replace(/\.html$/, "");
    if (page !== "pay") throw httpError(400, "invalid-return-url", "Billing return page is not allowed.");
    parsed.hash = "";
    if (!success) parsed.search = "";
    return parsed.toString();
}

function verifyStripeWebhookSignature(header, payload, secret) {
    var values = {};
    String(header || "").split(",").forEach(function (item) {
        var pair = item.split("=");
        if (pair.length === 2) values[pair[0]] = pair[1];
    });
    if (!values.t || !values.v1 || Math.abs(Math.floor(Date.now() / 1000) - Number(values.t)) > 300) {
        throw httpError(400, "invalid-signature", "Invalid Stripe signature.");
    }
    var expected = crypto.createHmac("sha256", secret).update(values.t + "." + payload).digest("hex");
    var expectedBuffer = Buffer.from(expected, "hex");
    var actualBuffer;
    try { actualBuffer = Buffer.from(values.v1, "hex"); } catch (error) { actualBuffer = Buffer.alloc(0); }
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        throw httpError(400, "invalid-signature", "Invalid Stripe signature.");
    }
}

async function setSupporterStatus(uid, values) {
    var app = getFirebaseApp();
    var ref = app.firestore().collection("users").doc(uid);
    var current = await ref.get();
    var currentExpiry = current.exists && current.data().proExpiresAt;
    currentExpiry = currentExpiry && typeof currentExpiry.toMillis === "function" ? currentExpiry.toMillis() : 0;
    var expiry = values.active ? Math.max(currentExpiry, Number(values.expiresAt || 0)) : Number(values.expiresAt || Date.now());
    var update = {
        isPro: values.active === true,
        proExpiresAt: admin.firestore.Timestamp.fromMillis(expiry)
    };
    if (values.stripeCustomerId) update.stripeCustomerId = values.stripeCustomerId;
    if (values.subscriptionType) update.subscriptionType = values.subscriptionType;
    await ref.set(update, { merge: true });
    var user = await app.auth().getUser(uid);
    var claims = Object.assign({}, user.customClaims || {}, { pro: values.active === true });
    await app.auth().setCustomUserClaims(uid, claims);
}

async function updateSupporterByCustomer(customerId, active, expiry) {
    var snapshot = await getFirebaseApp().firestore().collection("users").where("stripeCustomerId", "==", String(customerId)).limit(1).get();
    if (snapshot.empty) throw httpError(500, "supporter-not-found", "Stripe customer is not linked to a user.");
    await setSupporterStatus(snapshot.docs[0].id, { active: active, expiresAt: expiry });
}

async function handleMailRequest(event, path) {
    var user = await requireFirebaseUser(event, false);
    loadMailLibraries();
    var action = path.slice(path.lastIndexOf("/") + 1);
    var body = parseJsonBody(event);
    if (action === "folders") {
        await enforceUserWindowRateLimit(user.uid, "mail_read", 120, 60 * 1000);
        return mailGetFolders(body);
    }
    if (action === "messages") {
        await enforceUserWindowRateLimit(user.uid, "mail_read", 120, 60 * 1000);
        return mailFetchMessages(body);
    }
    if (action === "body") {
        await enforceUserWindowRateLimit(user.uid, "mail_read", 120, 60 * 1000);
        return mailFetchBody(body);
    }
    if (action === "flags") {
        await enforceUserWindowRateLimit(user.uid, "mail_write", 60, 60 * 1000);
        return mailModifyFlags(body);
    }
    if (action === "move") {
        await enforceUserWindowRateLimit(user.uid, "mail_write", 60, 60 * 1000);
        return mailMoveMessage(body);
    }
    if (action === "send") {
        await enforceUserWindowRateLimit(user.uid, "mail_send", 10, 60 * 60 * 1000);
        return mailSendMessage(body);
    }
    throw httpError(404, "not-found", "Mail endpoint not found.");
}

async function postFlipbook(event) {
    var user = await requireFirebaseUser(event, false);
    ensureSocialPostingEligible(user);
    var body = parseJsonBody(event);
    var data = validateFlipbookPayload(body.flipnote_data);
    var database = getSocialFirebaseApp().database();
    var timeoutSnapshot = await database.ref("timeouts/" + user.uid).once("value");
    var timeout = timeoutSnapshot.val();
    if (timeout && typeof timeout.until === "number" && timeout.until > Date.now()) {
        var minutes = Math.ceil((timeout.until - Date.now()) / 60000);
        throw httpError(403, "timed-out", "You are timed out. Please wait " + minutes + " minute(s) before posting.");
    }
    var rate = await consumeTokenBucket(database, user.uid, "kindlechat", 5, 12000);
    if (!rate.allowed) {
        var rateError = httpError(429, "rate-limited", "Rate limit exceeded. Please wait before posting again.");
        rateError.retryAfter = rate.retryAfter;
        throw rateError;
    }
    var message = {
        uid: user.uid,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        text: "",
        is_flipnote: true,
        flipnote_data: data
    };
    var messageRef = await database.ref("kindlechat/messages").push(message);
    await database.ref("kindlechat/art_index/" + messageRef.key).set({
        uid: user.uid,
        type: "flipbook",
        timestamp: admin.database.ServerValue.TIMESTAMP,
        thumbnail: data.frames[0],
        text: ""
    });
    return { allowed: true, key: messageRef.key };
}

function validateFlipbookPayload(value) {
    var data = value || {};
    var fps = Number(data.fps || 0);
    var frames = Array.isArray(data.frames) ? data.frames : [];
    if (!Number.isInteger(fps) || fps < 1 || fps > 24) throw httpError(400, "invalid-fps", "Invalid animation speed.");
    if (!frames.length || frames.length > 60) throw httpError(400, "invalid-frames", "Animation must contain 1-60 frames.");
    var total = 0;
    frames = frames.map(function (frame) {
        frame = String(frame || "");
        total += frame.length;
        if (!/^data:image\/(png|webp);base64,[a-zA-Z0-9+/=]+$/i.test(frame) || frame.length > 180000) {
            throw httpError(400, "invalid-frame", "Animation contains an invalid frame.");
        }
        return frame;
    });
    if (total > 2 * 1024 * 1024) throw httpError(413, "animation-too-large", "Animation is too large.");
    return { fps: fps, frames: frames };
}

async function consumeTokenBucket(database, uid, type, capacity, refillMs) {
    var now = Date.now();
    var allowed = false;
    var retryAfter = refillMs;
    await database.ref("kindlechat/server_rate_limits/" + uid + "/" + type).transaction(function (current) {
        current = current || { tokens: capacity, lastRefill: now };
        var elapsed = Math.max(0, now - Number(current.lastRefill || now));
        var refill = Math.floor(elapsed / refillMs);
        var tokens = Math.min(capacity, Number(current.tokens || 0) + refill);
        var lastRefill = refill > 0 ? Number(current.lastRefill || now) + refill * refillMs : Number(current.lastRefill || now);
        if (tokens < 1) {
            allowed = false;
            retryAfter = Math.max(1000, refillMs - (now - lastRefill));
            return { tokens: tokens, lastRefill: lastRefill, updatedAt: now };
        }
        allowed = true;
        return { tokens: tokens - 1, lastRefill: lastRefill, updatedAt: now };
    });
    return { allowed: allowed, retryAfter: retryAfter };
}

async function moderateAndPostSocial(event) {
    var user = await requireAnyFirebaseUser(event);
    var body = parseJsonBody(event);
    var type = String(body.type || "");
    if (type !== "report") ensureSocialPostingEligible(user);
    var social = getSocialFirebaseApp();
    var database = social.database();
    var firestore = social.firestore();
    if (!type) throw httpError(400, "invalid-argument", "Missing content type.");
    if (type !== "report") await ensureNotTimedOut(database, user.uid);
    var limits = {
        kindlechat: [5, 12000], topic: [3, 8 * 60 * 60 * 1000], topic_edit: [10, 60000], topic_comment: [5, 12000],
        neighbourhood_post: [5, 5 * 60 * 1000], neighbourhood_edit: [10, 60000], neighbourhood_comment: [10, 30000], report: [60, 60000]
    };
    if (!limits[type]) throw httpError(400, "invalid-type", "Unsupported social content type.");
    var rate = await consumeTokenBucket(database, user.uid, type, limits[type][0], limits[type][1]);
    if (!rate.allowed) {
        var rateError = httpError(429, "rate-limited", "Rate limit exceeded. Please wait before posting again.");
        rateError.retryAfter = Math.ceil(rate.retryAfter / 1000);
        throw rateError;
    }
    if (type === "kindlechat") return postKindleChat(body, user, database);
    if (type === "topic") return postTopic(body, user, database, firestore);
    if (type === "topic_edit") return editTopic(body, user, firestore);
    if (type === "topic_comment") return postTopicComment(body, user, database, firestore);
    if (type === "neighbourhood_post") return postNeighbourhood(body, user, database, firestore, false);
    if (type === "neighbourhood_edit") return editNeighbourhoodPost(body, user, firestore);
    if (type === "neighbourhood_comment") return postNeighbourhood(body, user, database, firestore, true);
    return createSocialReport(body, user, database, firestore);
}

async function postKindleChat(body, user, database) {
    var text = validateSocialText(body.text, 1000, true);
    var isPixelArt = body.is_pixel_art === true;
    var isFlipnote = body.is_flipnote === true;
    if (!text && !isPixelArt && !isFlipnote) throw httpError(400, "empty-message", "Empty message.");
    if (isPixelArt) validatePixelArt(body);
    if (!isPixelArt && !isFlipnote) {
        await ensureNotDuplicate(database, user.uid, "kindlechat", text);
        await ensureModerationAllowed(text);
    }
    var message = { uid: user.uid, timestamp: admin.database.ServerValue.TIMESTAMP, text: text };
    ["pixel_art", "grid_data", "is_pixel_art", "is_flipnote", "flipnote_data", "replyTo"].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(body, key)) message[key] = body[key];
    });
    var ref = await database.ref("kindlechat/messages").push(message);
    if (isPixelArt || isFlipnote) {
        var thumbnail = isPixelArt ? body.pixel_art : (body.flipnote_data && body.flipnote_data.frames && body.flipnote_data.frames[0]);
        await database.ref("kindlechat/art_index/" + ref.key).set({
            uid: user.uid, type: isPixelArt ? "pixel_art" : "flipbook", timestamp: admin.database.ServerValue.TIMESTAMP,
            thumbnail: thumbnail || null, text: text
        });
    }
    if (text) await recordDuplicate(database, user.uid, isPixelArt ? "kindlechat_pixel_art" : "kindlechat", isPixelArt ? body.grid_data : text);
    return { allowed: true, key: ref.key };
}

async function postTopic(body, user, database, firestore) {
    var title = String(body.title || "").trim();
    var subheading = String(body.subheading || "").trim();
    var icon = String(body.icon || "");
    if (!title || title.length > 20) throw httpError(400, "invalid-title", "Title must be 1-20 characters.");
    if (subheading.length > 35 || !icon || icon.length > 10000) throw httpError(400, "invalid-topic", "Invalid topic details.");
    validateNoLinksOrPromotion(title + " " + subheading);
    var poll = null;
    if (body.poll && typeof body.poll === "object") {
        var question = String(body.poll.question || "").trim();
        var options = Array.isArray(body.poll.options) ? body.poll.options.map(function (v) { return String(v || "").trim(); }).filter(Boolean) : [];
        if (!question || question.length > 100 || options.length < 2 || options.length > 4 || options.some(function (v) { return v.length > 50; })) {
            throw httpError(400, "invalid-poll", "Invalid poll.");
        }
        validateNoLinksOrPromotion(question + " " + options.join(" "));
        poll = { question: question, options: options };
    }
    var combined = title + " " + subheading + (poll ? " " + poll.question + " " + poll.options.join(" ") : "");
    await ensureNotDuplicate(database, user.uid, "topic", combined);
    await ensureModerationAllowed(combined);
    var data = { title: title, subheading: subheading, body: "", icon: icon, authorId: user.uid, timestamp: admin.firestore.FieldValue.serverTimestamp(), lastActive: admin.firestore.FieldValue.serverTimestamp(), commentCount: 0 };
    if (poll) data.poll = poll;
    var ref = await firestore.collection("topics").add(data);
    await recordDuplicate(database, user.uid, "topic", combined);
    return { success: true, id: ref.id };
}

async function postTopicComment(body, user, database, firestore) {
    var topicId = validateFirebaseId(body.topicId, "topic ID");
    var text = validateSocialText(body.body, 1000, false);
    await ensureNotDuplicate(database, user.uid, "topic_comment", text);
    await ensureModerationAllowed(text);
    var topicRef = firestore.collection("topics").doc(topicId);
    var commentRef = topicRef.collection("comments").doc();
    var count = 0;
    await firestore.runTransaction(async function (transaction) {
        var snapshot = await transaction.get(topicRef);
        if (!snapshot.exists) throw httpError(404, "not-found", "Topic not found.");
        count = Number(snapshot.data().commentCount || 0) + 1;
        transaction.set(commentRef, { body: text, authorId: user.uid, timestamp: admin.firestore.FieldValue.serverTimestamp() });
        transaction.update(topicRef, { commentCount: count, lastActive: admin.firestore.FieldValue.serverTimestamp() });
    });
    await recordDuplicate(database, user.uid, "topic_comment", text);
    return { success: true, id: commentRef.id, commentCount: count };
}

async function editTopic(body, user, firestore) {
    var topicId = validateFirebaseId(body.topicId, "topic ID");
    var title = String(body.title || "").trim();
    var subheading = String(body.subheading || "").trim();
    var icon = String(body.icon || "");
    if (!title || title.length > 20) throw httpError(400, "invalid-title", "Title must be 1-20 characters.");
    if (subheading.length > 35 || !icon || icon.length > 10000) throw httpError(400, "invalid-topic", "Invalid topic details.");
    var combined = title + " " + subheading;
    validateNoLinksOrPromotion(combined);
    await ensureModerationAllowed(combined);
    var ref = firestore.collection("topics").doc(topicId);
    var snapshot = await ref.get();
    if (!snapshot.exists) throw httpError(404, "not-found", "Topic not found.");
    if (snapshot.data().authorId !== user.uid) throw httpError(403, "forbidden", "Only the topic author can edit it.");
    await ref.update({ title: title, subheading: subheading, icon: icon });
    return { success: true, id: topicId };
}

async function postNeighbourhood(body, user, database, firestore, isComment) {
    var text = validateSocialText(body.text, isComment ? 200 : 280, false);
    if (isComment && text.length < 2) throw httpError(400, "invalid-comment", "Comment must be 2-200 characters.");
    if (!isComment && text.split(/\s+/).length < 10) throw httpError(400, "invalid-post", "Keep it meaningful! Minimum 10 words.");
    var type = isComment ? "neighbourhood_comment" : "neighbourhood_post";
    await ensureNotDuplicate(database, user.uid, type, text);
    await ensureModerationAllowed(text);
    var collection = isComment
        ? firestore.collection("neighbourhood_posts").doc(validateFirebaseId(body.postId, "post ID")).collection("comments")
        : firestore.collection("neighbourhood_posts");
    var ref = await collection.add({ uid: user.uid, text: text, timestamp: admin.firestore.FieldValue.serverTimestamp() });
    await recordDuplicate(database, user.uid, type, text);
    return { success: true, id: ref.id };
}

async function editNeighbourhoodPost(body, user, firestore) {
    var postId = validateFirebaseId(body.postId, "post ID");
    var text = validateSocialText(body.text, 280, false);
    if (text.split(/\s+/).length < 10) throw httpError(400, "invalid-post", "Keep it meaningful! Minimum 10 words.");
    await ensureModerationAllowed(text);
    var ref = firestore.collection("neighbourhood_posts").doc(postId);
    var snapshot = await ref.get();
    if (!snapshot.exists) throw httpError(404, "not-found", "Post not found.");
    if (snapshot.data().uid !== user.uid) throw httpError(403, "forbidden", "Only the post author can edit it.");
    await ref.update({ text: text });
    return { success: true, id: postId };
}

async function createSocialReport(body, user, database) {
    var allowedTypes = { kindlechat: true, topic: true, topic_comment: true, neighbourhood_post: true, neighbourhood_comment: true, suggestion: true, suggestion_comment: true };
    var contentType = String(body.contentType || "");
    var contentId = validateFirebaseId(body.contentId, "content ID");
    if (!allowedTypes[contentType]) throw httpError(400, "invalid-report", "Invalid report type.");
    var report = {
        reporterId: user.uid,
        reporterName: String(user.email || "").split("@")[0],
        reportedUserId: String(body.reportedUserId || "").slice(0, 128),
        contentType: contentType,
        contentId: contentId,
        contentPath: String(body.contentPath || "").slice(0, 500),
        reason: String(body.reason || "").slice(0, 100),
        comment: String(body.comment || "").slice(0, 1000),
        contentSnapshot: String(body.contentSnapshot || "").slice(0, 2000),
        status: "pending",
        timestamp: admin.database.ServerValue.TIMESTAMP
    };
    if (!report.reason) throw httpError(400, "invalid-report", "A report reason is required.");
    var existingSnapshot = await database.ref("reports").orderByChild("contentId").equalTo(contentId).once("value");
    var existingDifferentReporter = null;
    existingSnapshot.forEach(function (child) {
        var value = child.val() || {};
        if (!existingDifferentReporter && value.contentType === contentType && value.status === "pending" && value.reporterId !== user.uid) {
            existingDifferentReporter = { key: child.key, value: value };
        }
    });
    var ref = await database.ref("reports").push(report);
    var immediate = { kindlechat: true, topic_comment: true, neighbourhood_comment: true, suggestion_comment: true };
    var twoReports = { topic: true, neighbourhood_post: true, suggestion: true };
    var shouldDelete = immediate[contentType] || (twoReports[contentType] && existingDifferentReporter);
    if (shouldDelete) {
        try {
            await deleteReportedContent(contentType, contentId, report.contentPath, database);
            var resolution = { status: "resolved", autoDeleted: true, resolvedAt: admin.database.ServerValue.TIMESTAMP };
            await ref.update(resolution);
            if (existingDifferentReporter) await database.ref("reports/" + existingDifferentReporter.key).update(resolution);
            report.autoDeleted = true;
        } catch (error) {
            await ref.update({ resolutionNote: "Auto-delete failed", deleteError: String(error.message || error).slice(0, 500) });
        }
    }
    await sendDiscordReport(report, ref.key).catch(function (error) { console.error("Discord report notification failed", error.message); });
    return { success: true, id: ref.key, autoDeleted: report.autoDeleted === true };
}

async function createPrimarySuggestionReport(event) {
    var user = await requireFirebaseUser(event);
    await enforceUserWindowRateLimit(user.uid, "suggestion_report", 60, 60 * 60 * 1000);
    var database = getFirebaseApp().database();
    var request = validatePrimarySuggestionReport(parseJsonBody(event));
    var contentRef = database.ref(request.contentPath);
    var contentSnapshot = await contentRef.once("value");
    if (!contentSnapshot.exists()) throw httpError(404, "not-found", "Reported content was not found.");
    var content = contentSnapshot.val() || {};
    var ownerUid = String(content.authorUid || "");
    if (!ownerUid || ownerUid !== request.reportedUserId) {
        throw httpError(400, "invalid-report", "Reported content owner does not match.");
    }
    if (ownerUid === user.uid) throw httpError(400, "invalid-report", "You cannot report your own content.");

    var report = {
        reporterId: user.uid,
        reporterName: String(user.email || "").split("@")[0],
        reportedUserId: ownerUid,
        contentType: request.contentType,
        contentId: request.contentId,
        contentPath: request.contentPath,
        reason: request.reason,
        comment: request.comment,
        contentSnapshot: primarySuggestionReportSnapshot(request.contentType, content),
        status: "pending",
        timestamp: admin.database.ServerValue.TIMESTAMP
    };
    var existingSnapshot = await database.ref("suggestion_reports").orderByChild("contentId").equalTo(request.contentId).once("value");
    var existingDifferentReporter = null;
    existingSnapshot.forEach(function (child) {
        var value = child.val() || {};
        if (!existingDifferentReporter && value.contentType === request.contentType && value.status === "pending" && value.reporterId !== user.uid) {
            existingDifferentReporter = { key: child.key };
        }
    });
    var reportRef = await database.ref("suggestion_reports").push(report);
    var shouldDelete = request.contentType === "suggestion_comment" || Boolean(existingDifferentReporter);
    if (shouldDelete) {
        await contentRef.remove();
        var resolution = { status: "resolved", autoDeleted: true, resolvedAt: admin.database.ServerValue.TIMESTAMP };
        await reportRef.update(resolution);
        if (existingDifferentReporter) {
            await database.ref("suggestion_reports/" + existingDifferentReporter.key).update(resolution);
        }
        report.autoDeleted = true;
    }
    await sendDiscordReport(report, reportRef.key).catch(function (error) {
        console.error("Discord report notification failed", error.message);
    });
    return { success: true, id: reportRef.key, autoDeleted: report.autoDeleted === true };
}

function validatePrimarySuggestionReport(body) {
    body = body || {};
    var contentType = String(body.contentType || "");
    if (contentType !== "suggestion" && contentType !== "suggestion_comment") {
        throw httpError(400, "invalid-report", "Invalid primary report type.");
    }
    var contentId = validateFirebaseId(body.contentId, "content ID");
    var contentPath = String(body.contentPath || "");
    if (contentType === "suggestion") {
        if (contentPath !== "suggestions/" + contentId) {
            throw httpError(400, "invalid-report", "Invalid suggestion path.");
        }
    } else if (!/^suggestions\/[a-zA-Z0-9_-]+\/comments\/[a-zA-Z0-9_-]+$/.test(contentPath) || !endsWith(contentPath, "/" + contentId)) {
        throw httpError(400, "invalid-report", "Invalid suggestion comment path.");
    }
    var reasons = { spam: true, harassment: true, inappropriate: true, hate_speech: true, self_harm: true, violence: true, other: true };
    var reason = String(body.reason || "");
    if (!reasons[reason]) throw httpError(400, "invalid-report", "A valid report reason is required.");
    var comment = String(body.comment || "").trim();
    if (comment.length > 200) throw httpError(400, "invalid-report", "Report comment is too long.");
    return {
        contentType: contentType,
        contentId: contentId,
        contentPath: contentPath,
        reportedUserId: validateFirebaseId(body.reportedUserId, "reported user ID"),
        reason: reason,
        comment: comment
    };
}

function primarySuggestionReportSnapshot(contentType, content) {
    if (contentType === "suggestion_comment") return String(content.text || "").slice(0, 2000);
    return (String(content.title || "") + " - " + String(content.description || "")).slice(0, 2000);
}

async function deleteReportedContent(type, id, path, socialDatabase) {
    var socialFirestore = getSocialFirebaseApp().firestore();
    if (type === "kindlechat") {
        await socialDatabase.ref("kindlechat/messages/" + id).remove();
        await socialDatabase.ref("kindlechat/art_index/" + id).remove();
        return;
    }
    if (type === "topic") return socialFirestore.collection("topics").doc(id).delete();
    if (type === "neighbourhood_post") return socialFirestore.collection("neighbourhood_posts").doc(id).delete();
    if (type === "topic_comment" && /^topics\/[a-zA-Z0-9_-]+\/comments\/[a-zA-Z0-9_-]+$/.test(path)) return socialFirestore.doc(path).delete();
    if (type === "neighbourhood_comment" && /^neighbourhood_posts\/[a-zA-Z0-9_-]+\/comments\/[a-zA-Z0-9_-]+$/.test(path)) return socialFirestore.doc(path).delete();
    if (type === "suggestion") return getFirebaseApp().database().ref("suggestions/" + id).remove();
    if (type === "suggestion_comment" && /^suggestions\/[a-zA-Z0-9_-]+\/comments\/[a-zA-Z0-9_-]+$/.test(path)) return getFirebaseApp().database().ref(path).remove();
    throw new Error("Reported content path is invalid.");
}

async function sendDiscordReport(report, reportId) {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) return;
    var description = String(report.contentSnapshot || "No content snapshot").slice(0, 1000).replace(/```/g, "` ` `");
    var upstream = await fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(process.env.DISCORD_CHANNEL_ID) + "/messages", {
        method: "POST",
        headers: { "Authorization": "Bot " + process.env.DISCORD_BOT_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [{ title: report.autoDeleted ? "Report: content auto-deleted" : "New content report", description: description, fields: [
            { name: "Type", value: report.contentType, inline: true },
            { name: "Reason", value: report.reason, inline: true },
            { name: "Report ID", value: reportId, inline: false }
        ] }] })
    });
    if (!upstream.ok) throw new Error("Discord returned HTTP " + upstream.status);
}

async function translateSocialContent(event, context) {
    var user = await requireAnyFirebaseUser(event);
    ensureSocialPostingEligible(user);
    var body = parseJsonBody(event);
    var msgId = validateFirebaseId(body.msgId, "message ID");
    var social = getSocialFirebaseApp();
    var text;
    var ownerUid;
    if (body.app === "neighbourhood") {
        var postSnapshot = await social.firestore().collection("neighbourhood_posts").doc(msgId).get();
        if (!postSnapshot.exists) throw httpError(404, "not-found", "Post not found.");
        text = String(postSnapshot.data().text || "").trim();
        ownerUid = postSnapshot.data().uid;
    } else {
        var messageSnapshot = await social.database().ref("kindlechat/messages/" + msgId).once("value");
        var message = messageSnapshot.val();
        if (!message) throw httpError(404, "not-found", "Message not found.");
        text = String(message.text || "").trim();
        ownerUid = message.uid;
    }
    if (ownerUid !== user.uid && user.moderator !== true && user.email !== "ukiyo@rekindle.ink") {
        throw httpError(403, "forbidden", "Only the author or a moderator can request translation.");
    }
    if (!text || text.length > 2000) throw httpError(400, "invalid-text", "Invalid translation text.");
    await enforceUserWindowRateLimit(user.uid, "social_translate", 60, 60 * 60 * 1000);
    var targetLanguages = ["en", "es", "pt", "pl", "de", "it", "fr", "ru", "zh", "vi"];
    var translations = {};
    var token = getYandexIamToken(context);
    var folderId = String(process.env.YANDEX_FOLDER_ID || context.functionFolderId || "");
    for (var i = 0; i < targetLanguages.length; i++) {
        var upstream = await fetch("https://translate.api.cloud.yandex.net/translate/v2/translate", {
            method: "POST",
            headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "x-folder-id": folderId, "x-data-logging-enabled": "false" },
            body: JSON.stringify({ folderId: folderId, texts: [text], targetLanguageCode: targetLanguages[i] })
        });
        var result = await readUpstreamResponse(upstream);
        if (result.status >= 200 && result.status < 300 && result.body.translations && result.body.translations[0] && result.body.translations[0].text !== text) {
            translations[targetLanguages[i]] = result.body.translations[0].text;
        }
    }
    if (body.app === "neighbourhood") {
        await social.firestore().collection("neighbourhood_posts").doc(msgId).set({ translation: translations, reprocessedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } else {
        var updates = {};
        Object.keys(translations).forEach(function (lang) { updates[lang + "/" + msgId] = translations[lang]; });
        if (Object.keys(updates).length) await social.database().ref("kindlechat/translations_by_lang").update(updates);
    }
    return { success: true, msgId: msgId, translation: translations, skipped: Object.keys(translations).length === 0 };
}

async function requireAnyFirebaseUser(event) {
    var header = String(getHeader(event, "authorization") || "");
    var token = header.indexOf("Bearer ") === 0 ? header.slice(7) : getHeader(event, "x-firebase-token");
    if (!token) throw httpError(401, "unauthenticated", "Authentication is required.");
    try { return await getSocialFirebaseApp().auth().verifyIdToken(token, true); } catch (socialError) {
        try { return await getFirebaseApp().auth().verifyIdToken(token, true); } catch (primaryError) {
            throw httpError(401, "unauthenticated", "Session is invalid or expired.");
        }
    }
}

function ensureSocialPostingEligible(user) {
    if (!user || (user.ageVerified !== true && user.email !== "ukiyo@rekindle.ink")) {
        throw httpError(403, "age-verification-required", "Age verification is required for social posting.");
    }
}

async function ensureNotTimedOut(database, uid) {
    var snapshot = await database.ref("timeouts/" + uid).once("value");
    var value = snapshot.val();
    if (value && Number(value.until || 0) > Date.now()) throw httpError(403, "timed-out", "You are currently timed out.");
}

function validateSocialText(value, max, allowEmpty) {
    var text = String(value || "").substring(0, max).replace(/(\n\s*){3,}/g, "\n\n").trim();
    if (!allowEmpty && !text) throw httpError(400, "empty-message", "Message is empty.");
    validateNoLinksOrPromotion(text);
    return text;
}

function validateNoLinksOrPromotion(text) {
    var value = String(text || "").toLowerCase();
    if (/h\s*t\s*t\s*p\s*s?\s*[:/]{1,4}|\bwww\.|\b[a-z0-9-]+\s*\.\s*(com|net|org|io|co|ai|app|dev|edu|gov|mil|int|biz|info|name|pro|museum|aero|coop|jobs|mobi|travel|arpa|asia|cat|tel|xxx|post|geo|mail|onion|bit|crypto|eth|us|uk|au|ca|de|fr|jp|cn|kr|ru|br|mx|es|it|nl|se|no|fi|dk|pl|cz|at|ch|be|pt|ie|nz|za|in|sg|hk|tw|id|th|vn|ph|my|xyz|club|online|site|top|ink|cc|tv|ws|me|nu|gg|to|vc|link)\b|\b\d{1,3}(\.\d{1,3}){3}\b/.test(value)) {
        throw httpError(400, "links-not-allowed", "Links and URLs are not allowed.");
    }
    if (/\b(?:unreader|un-reader|inkchat|kindlehub)\b/i.test(value)) throw httpError(400, "promotion-not-allowed", "Promotional content is not allowed.");
}

async function ensureModerationAllowed(text) {
    var clean = stripAsciiArt(text);
    if (!clean) return;
    var result = await readUpstreamResponse(await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: { "Authorization": "Bearer " + getRequiredEnv("OPENAI_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ model: "omni-moderation-latest", input: clean })
    }));
    if (result.status < 200 || result.status >= 300) throw upstreamError(result, "Content moderation failed.");
    var moderation = result.body.results && result.body.results[0];
    if (moderation && moderation.flagged) throw httpError(400, "content-flagged", "Your message was flagged by content moderation and cannot be posted.");
}

function stripAsciiArt(text) {
    var arts = [
        "\\˚ㄥ˚\\", "☁ ▅▒░☼‿☼░▒▅ ☁", "ˁ˚ᴥ˚ˀ", "⎦˚◡˚⎣", "<*_*>", "(-(-_(-_-)_-)-)",
        "(✿ ♥‿♥)", "㋡", "(⌒▽⌒)", "(◔/‿\\◔)", "(⋗_⋖)", "ة_ة", "\\(^-^)/", "◕_◕", "(っ◕‿◕)っ",
        "( ͠° ͟ʖ ͡°)", "ʘ‿ʘ", "(｡◕‿◕｡)", "☜(⌒▽⌒)☞", "ヽ(´▽`)/", "ヽ(´ー｀)ノ", "⊂(◉‿◉)つ",
        "(づ￣ ³￣)づ", "“ヽ(´▽｀)ノ”", "♥‿♥", "( ˘ ³˘)♥", "\\(ᵔᵕᵔ)/", "ᴖ̮ ̮ᴖ", "-`ღ´-", "ಠ_ಠ",
        "(╬ ಠ益ಠ)", "ლ(ಠ益ಠლ)", "ಠ‿ಠ", "ಥ_ಥ", "ಥ﹏ಥ", "٩◔̯◔۶", "(´･_･`)", "(ಥ⌣ಥ)", "눈_눈",
        "( ఠ ͟ʖ ఠ)", "( ͡ಠ ʖ̯ ͡ಠ)", "( ಠ ʖ̯ ಠ)", "(ᵟຶ︵ ᵟຶ)", "¯\\_(ツ)_/¯", "( ͡° ͜ʖ ͡°)",
        "ᕙ(⇀‸↼‶)ᕗ", "┌(ㆆ㉨ㆆ)ʃ", "(•̀ᴗ•́)و ̑̑", "(☞ﾟヮﾟ)☞", "(っ▀¯▀)つ", "(∩｀-´)⊃━☆ﾟ.*･｡ﾟ",
        "(╯°□°）╯︵ ┻━┻", "┬─┬ ノ( ゜-゜ノ)", "┬─┬⃰͡ (ᵔᵕᵔ͜ )", "(ง'̀-'́)ง", "ʕ•ᴥ•ʔ", "ʕᵔᴥᵔʔ",
        "ʕ •`ᴥ•´ʔ", "V•ᴥ•V", "ฅ^•ﻌ•^ฅ", "ʕ •́؈•̀ ₎", "{•̃_•̃}", "(ᵔᴥᵔ)", "[¬º-°]¬", "ƪ(ړײ)‎ƪ​​",
        "¯\\(°_o)/¯", "⊙﹏⊙", "¯\\_(⊙︿⊙)_/¯", "¿ⓧ_ⓧﮌ", "(⊙.☉)7", "٩(๏_๏)۶", "(⊙_◎)",
        "ミ●﹏☉ミ", "(Ծ‸ Ծ)", "⥀.⥀", "♨_♨", "(._.)"
    ];
    arts.sort(function (a, b) { return b.length - a.length; });
    var clean = String(text || "");
    arts.forEach(function (art) { clean = clean.split(art).join(""); });
    return clean.trim();
}

async function ensureNotDuplicate(database, uid, type, text) {
    var hash = hashSocialText(text);
    var snapshot = await database.ref("kindlechat/user_recent/" + uid + "/" + type + "/" + hash).once("value");
    var timestamp = Number(snapshot.val() || 0);
    if (timestamp && Date.now() - timestamp < 5 * 60 * 1000) throw httpError(429, "duplicate", "You already posted this recently. Please wait a few minutes.");
}

async function recordDuplicate(database, uid, type, text) {
    await database.ref("kindlechat/user_recent/" + uid + "/" + type + "/" + hashSocialText(text)).set(admin.database.ServerValue.TIMESTAMP);
}

function hashSocialText(text) {
    var normalized = String(text || "").toLowerCase().replace(/[^a-z0-9\u0400-\u04ff\s]/g, "").replace(/\s+/g, " ").trim();
    var hash = 5381;
    for (var i = 0; i < normalized.length; i++) hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    return (hash >>> 0).toString(16);
}

function validateFirebaseId(value, label) {
    var id = String(value || "");
    if (!id || id.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(id)) throw httpError(400, "invalid-id", "Invalid " + label + ".");
    return id;
}

function validatePixelArt(body) {
    var data = String(body.pixel_art || "");
    var grid = String(body.grid_data || "");
    if (!/^data:image\/(png|webp);base64,[a-zA-Z0-9+/=]+$/i.test(data) || data.length > 500000 || grid.length > 100000) {
        throw httpError(400, "invalid-pixel-art", "Invalid pixel art.");
    }
    try {
        var parsed = JSON.parse(grid);
        if (!Array.isArray(parsed) || parsed.length === 64 || parsed.every(function (row) { return Array.isArray(row) && row.every(function (cell) { return cell === 0; }); })) {
            throw new Error("invalid");
        }
    } catch (error) { throw httpError(400, "invalid-pixel-art", "Invalid or blank pixel art."); }
}

function loadMailLibraries() {
    if (ImapFlow && simpleParser && nodemailer) return;
    ImapFlow = require("imapflow").ImapFlow;
    simpleParser = require("mailparser").simpleParser;
    nodemailer = require("nodemailer");
}

async function mailGetFolders(body) {
    var config = await validateMailServer(body.imap, "imap");
    return withImapClient(config, async function (client) {
        var folders = await client.list();
        return {
            success: true,
            folders: folders.map(function (folder) {
                return {
                    path: folder.path,
                    name: folder.name,
                    delimiter: folder.delimiter,
                    specialUse: folder.specialUse,
                    flags: Array.from(folder.flags || [])
                };
            })
        };
    });
}

async function mailFetchMessages(body) {
    var config = await validateMailServer(body.imap, "imap");
    var mailboxPath = validateMailboxPath(body.path || "INBOX");
    var cursor = body.cursor ? validatePositiveInteger(body.cursor, "cursor") : null;
    var limit = Math.min(50, validatePositiveInteger(body.limit || 20, "limit"));
    return withImapClient(config, async function (client) {
        var lock = await client.getMailboxLock(mailboxPath);
        try {
            var status = await client.status(mailboxPath, { messages: true });
            var total = Number(status.messages || 0);
            if (!total) return { success: true, messages: [], nextCursor: null };
            var end = cursor ? Math.max(1, cursor - 1) : total;
            var start = Math.max(1, end - limit + 1);
            if (end < 1) return { success: true, messages: [], nextCursor: null };
            var messages = [];
            for await (var message of client.fetch(start + ":" + end, {
                envelope: true,
                source: { maxLength: 1024 },
                flags: true,
                internalDate: true
            })) {
                var snippet = "";
                try {
                    if (message.source) {
                        var parsed = await simpleParser(message.source);
                        snippet = parsed.text ? parsed.text.substring(0, 100).replace(/\s+/g, " ").trim() : "";
                    }
                } catch (error) {}
                var envelope = Object.assign({}, message.envelope);
                envelope.date = message.envelope && message.envelope.date ? message.envelope.date.toISOString() : null;
                messages.push({
                    uid: message.uid,
                    seq: message.seq,
                    envelope: envelope,
                    flags: Array.from(message.flags || []),
                    internalDate: message.internalDate ? message.internalDate.toISOString() : null,
                    snippet: snippet
                });
            }
            messages.reverse();
            return { success: true, messages: messages, nextCursor: start > 1 ? start : null };
        } finally {
            lock.release();
        }
    });
}

async function mailFetchBody(body) {
    var config = await validateMailServer(body.imap, "imap");
    var mailboxPath = validateMailboxPath(body.path || "INBOX");
    var uid = validatePositiveInteger(body.uid, "uid");
    return withImapClient(config, async function (client) {
        var lock = await client.getMailboxLock(mailboxPath);
        try {
            var message = await client.fetchOne(String(uid), { source: true, uid: true });
            if (!message || !message.source) throw httpError(404, "not-found", "Message not found.");
            var parsed = await simpleParser(message.source);
            var cleanedHtml = parsed.html || "";
            if (cleanedHtml) {
                cleanedHtml = cleanedHtml.replace(/<(p|div)[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, "");
                cleanedHtml = cleanedHtml.replace(/(<br\s*\/?>\s*)+/gi, "<br>");
            }
            return {
                success: true,
                email: {
                    subject: parsed.subject,
                    from: parsed.from,
                    to: parsed.to,
                    date: parsed.date ? parsed.date.toISOString() : null,
                    text: parsed.text,
                    html: cleanedHtml,
                    attachments: []
                }
            };
        } finally {
            lock.release();
        }
    });
}

async function mailModifyFlags(body) {
    var config = await validateMailServer(body.imap, "imap");
    var mailboxPath = validateMailboxPath(body.path || "INBOX");
    var uid = validatePositiveInteger(body.uid, "uid");
    var allowedFlags = { "\\Seen": true, "\\Flagged": true, "\\Answered": true, "\\Draft": true };
    var addFlags = validateMailFlags(body.addFlags, allowedFlags);
    var removeFlags = validateMailFlags(body.removeFlags, allowedFlags);
    return withImapClient(config, async function (client) {
        var lock = await client.getMailboxLock(mailboxPath);
        try {
            if (addFlags.length) await client.messageFlagsAdd(String(uid), addFlags, { uid: true });
            if (removeFlags.length) await client.messageFlagsRemove(String(uid), removeFlags, { uid: true });
            return { success: true };
        } finally {
            lock.release();
        }
    });
}

async function mailMoveMessage(body) {
    var config = await validateMailServer(body.imap, "imap");
    var mailboxPath = validateMailboxPath(body.path || "INBOX");
    var destination = validateMailboxPath(body.destination);
    var uid = validatePositiveInteger(body.uid, "uid");
    return withImapClient(config, async function (client) {
        var lock = await client.getMailboxLock(mailboxPath);
        try {
            await client.messageMove(String(uid), destination, { uid: true });
            return { success: true };
        } finally {
            lock.release();
        }
    });
}

async function mailSendMessage(body) {
    var config = await validateMailServer(body.smtp, "smtp");
    var message = body.message || {};
    var to = String(message.to || "").trim();
    var subject = String(message.subject || "").slice(0, 500);
    var text = String(message.text || "");
    var html = String(message.html || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || /[\r\n]/.test(to)) {
        throw httpError(400, "invalid-recipient", "Invalid email recipient.");
    }
    if (text.length > 200000 || html.length > 400000) throw httpError(413, "message-too-large", "Email body is too large.");
    var transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        tls: { servername: config.host }
    });
    var info = await transporter.sendMail({
        from: config.auth.user,
        to: to,
        subject: subject,
        text: text,
        html: html
    });
    return { success: true, messageId: info.messageId };
}

async function withImapClient(config, callback) {
    var client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
        logger: false,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        tls: { servername: config.host }
    });
    try {
        await client.connect();
        return await callback(client);
    } catch (error) {
        if (error && error.status) throw error;
        throw httpError(502, "mail-upstream-error", "Mail server error: " + String(error.message || "Connection failed."));
    } finally {
        await client.logout().catch(function () {});
    }
}

async function validateMailServer(input, type) {
    var config = input || {};
    var host = String(config.host || "").trim().toLowerCase();
    var port = Number(config.port || (type === "imap" ? 993 : 465));
    var allowedPorts = type === "imap" ? { 143: true, 993: true } : { 25: true, 465: true, 587: true };
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host === "localhost" || endsWith(host, ".local")) {
        throw httpError(400, "invalid-mail-host", "Invalid mail server host.");
    }
    if (!allowedPorts[port]) throw httpError(400, "invalid-mail-port", "Unsupported mail server port.");
    var auth = config.auth || {};
    var username = String(auth.user || "");
    var password = String(auth.pass || "");
    if (!username || !password || username.length > 320 || password.length > 1000 || /[\r\n]/.test(username)) {
        throw httpError(400, "invalid-mail-auth", "Invalid mail server credentials.");
    }
    var addresses;
    try {
        addresses = await dns.lookup(host, { all: true });
    } catch (error) {
        throw httpError(400, "mail-host-unresolved", "Mail server host could not be resolved.");
    }
    if (!addresses.length || addresses.some(function (entry) { return isPrivateAddress(entry.address); })) {
        throw httpError(400, "private-mail-host", "Private or local mail servers are not allowed.");
    }
    return { host: host, port: port, secure: config.secure !== false, auth: { user: username, pass: password } };
}

function isPrivateAddress(address) {
    var value = String(address || "").toLowerCase();
    if (value.indexOf("::ffff:") === 0) value = value.slice(7);
    if (net.isIP(value) === 4) {
        var parts = value.split(".").map(Number);
        return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
            (parts[0] === 169 && parts[1] === 254) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224;
    }
    if (net.isIP(value) === 6) {
        return value === "::" || value === "::1" || value.indexOf("fe8") === 0 ||
            value.indexOf("fe9") === 0 || value.indexOf("fea") === 0 || value.indexOf("feb") === 0 ||
            value.indexOf("fc") === 0 || value.indexOf("fd") === 0;
    }
    return true;
}

function validateMailboxPath(value) {
    var path = String(value || "");
    if (!path || path.length > 500 || /[\u0000\r\n]/.test(path)) throw httpError(400, "invalid-mailbox", "Invalid mailbox path.");
    return path;
}

function validatePositiveInteger(value, name) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 2147483647) {
        throw httpError(400, "invalid-" + name, "Invalid " + name + ".");
    }
    return number;
}

function validateMailFlags(value, allowed) {
    var flags = Array.isArray(value) ? value : [];
    if (flags.some(function (flag) { return !allowed[flag]; })) throw httpError(400, "invalid-flags", "Invalid mail flags.");
    return flags;
}

async function enforceDailyLimit(uid, bucket, limit) {
    var now = new Date();
    var day = now.getUTCFullYear() + "-" + padTwo(now.getUTCMonth() + 1) + "-" + padTwo(now.getUTCDate());
    var allowed = false;
    var ref = getFirebaseApp().database().ref("api_daily_limits/" + uid + "/" + bucket + "/" + day);
    await ref.transaction(function (current) {
        allowed = false;
        current = current || { count: 0 };
        if (current.count >= limit) return;
        allowed = true;
        current.count += 1;
        current.updatedAt = Date.now();
        return current;
    });
    if (!allowed) throw httpError(429, "daily-limit", "Daily AI message limit reached.");
}

function validateProviderEndpoint(value, provider) {
    var defaults = provider === "gemini" ? "https://generativelanguage.googleapis.com" : "https://api.openai.com";
    var parsed;
    try {
        parsed = new URL(String(value || defaults));
    } catch (error) {
        throw httpError(400, "invalid-provider-endpoint", "Invalid AI provider endpoint.");
    }
    var allowedHosts = {
        "api.openai.com": true,
        "api.groq.com": true,
        "api.x.ai": true,
        "api.mistral.ai": true,
        "api.perplexity.ai": true,
        "api.together.xyz": true,
        "api.fireworks.ai": true,
        "generativelanguage.googleapis.com": true
    };
    if (parsed.protocol !== "https:" || !allowedHosts[parsed.hostname] || parsed.username || parsed.password) {
        throw httpError(400, "invalid-provider-endpoint", "AI provider endpoint is not allowed.");
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
}

function openAiApiUrl(base, suffix) {
    var parsed = new URL(base);
    var path = parsed.pathname.replace(/\/$/, "");
    if ((!path || path === "/") && parsed.hostname === "api.openai.com") path = "/v1";
    if (!path || path === "/") path = "";
    parsed.pathname = path + suffix;
    return parsed.toString();
}

function getYandexIamToken(context) {
    var token = context && context.token && context.token.access_token;
    token = token || process.env.YANDEX_IAM_TOKEN;
    if (!token) throw new Error("Yandex IAM token is unavailable. Attach a service account to the function.");
    return token;
}

function upstreamError(result, fallback) {
    var message = result.body && result.body.error;
    if (message && typeof message === "object") message = message.message;
    return httpError(502, "upstream-error", String(message || fallback));
}

function padTwo(value) {
    return value < 10 ? "0" + value : String(value);
}

async function enforceUserWindowRateLimit(uid, bucket, limit, windowMs) {
    var now = Date.now();
    var allowed = false;
    var ref = getFirebaseApp().database().ref("api_rate_limits/" + uid + "/" + bucket);
    await ref.transaction(function (current) {
        allowed = false;
        current = current || { count: 0, windowStartedAt: now };
        if (!current.windowStartedAt || now - current.windowStartedAt >= windowMs) {
            current = { count: 0, windowStartedAt: now };
        }
        if (current.count >= limit) return;
        allowed = true;
        current.count += 1;
        current.updatedAt = now;
        return current;
    });
    if (!allowed) throw httpError(429, "rate-limited", "Too many requests. Please try again later.");
}

async function enforcePublicIpRateLimit(event, bucket, limit, windowMs) {
    if (event.requestContext && event.requestContext.skipProxyRateLimit) return;
    var ipKey = sanitizeIp(getSourceIp(event)) || "unknown";
    await enforceWindowRateLimitRef(getFirebaseApp().database().ref("api_public_rate_limits/" + ipKey + "/" + bucket), limit, windowMs);
}

async function enforceWindowRateLimitRef(ref, limit, windowMs) {
    var now = Date.now();
    var allowed = false;
    await ref.transaction(function (current) {
        allowed = false;
        current = current || { count: 0, windowStartedAt: now };
        if (!current.windowStartedAt || now - current.windowStartedAt >= windowMs) current = { count: 0, windowStartedAt: now };
        if (current.count >= limit) return;
        allowed = true;
        current.count += 1;
        current.updatedAt = now;
        return current;
    });
    if (!allowed) throw httpError(429, "rate-limited", "Too many proxy requests. Please try again later.");
}

function validateRedirectUri(value, expectedPage) {
    var parsed;
    try {
        parsed = new URL(String(value || ""));
    } catch (error) {
        throw httpError(400, "invalid-redirect", "Invalid OAuth redirect URI.");
    }
    if (getAllowedOrigins().indexOf(parsed.origin) === -1) {
        throw httpError(400, "invalid-redirect", "OAuth redirect origin is not allowed.");
    }
    var page = parsed.pathname.split("/").pop().replace(/\.html$/, "");
    if (page !== expectedPage) throw httpError(400, "invalid-redirect", "OAuth redirect page is not allowed.");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
}

function validateSubstackDomain(value) {
    var domain = String(value || "").toLowerCase().replace(/\.$/, "");
    if (domain !== "substack.com" && !endsWith(domain, ".substack.com")) {
        throw httpError(400, "invalid-target", "Substack target is not allowed.");
    }
    if (!/^[a-z0-9.-]+$/.test(domain)) throw httpError(400, "invalid-target", "Substack target is not allowed.");
    return domain;
}

function appendQueryParameters(url, query) {
    Object.keys(query).forEach(function (key) {
        var value = query[key];
        if (Array.isArray(value)) {
            value.forEach(function (item) { url.searchParams.append(key, String(item)); });
        } else if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
        }
    });
}

async function readUpstreamResponse(upstream) {
    var text = await upstream.text();
    var body;
    try {
        body = text ? JSON.parse(text) : {};
    } catch (error) {
        body = { error: text || "Upstream returned an invalid response." };
    }
    return { status: upstream.status, body: body };
}

function upstreamResponse(result, origin) {
    return response(result.status, result.body, origin);
}

async function requireFirebaseUser(event) {
    var token = getHeader(event, "x-firebase-token");
    if (!token) throw httpError(401, "unauthenticated", "Authentication is required.");
    var decoded;
    try {
        decoded = await getFirebaseApp().auth().verifyIdToken(token, true);
    } catch (error) {
        throw httpError(401, "unauthenticated", "Session is invalid or expired.");
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

function getSocialFirebaseApp() {
    if (socialFirebaseApp) return socialFirebaseApp;
    var serviceAccountRaw = getRequiredEnv("SOCIAL_FIREBASE_SERVICE_ACCOUNT_JSON");
    var serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountRaw);
    } catch (error) {
        throw new Error("SOCIAL_FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    socialFirebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://rekindle-socials-default-rtdb.firebaseio.com",
        projectId: "rekindle-socials"
    }, "rekindle-yandex-social");
    return socialFirebaseApp;
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
            "Access-Control-Allow-Headers": "Content-Type, X-Firebase-Token, Authorization, X-Substack-SID, X-Substack-Target, X-Readwise-Token, stripe-signature",
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "Vary": "Origin"
        },
        isBase64Encoded: false,
        body: typeof body === "string" ? body : JSON.stringify(body)
    };
}

function rawResponse(statusCode, bytes, origin, contentType, cacheSeconds) {
    var allowedOrigin = isAllowedOrigin(origin) && origin ? origin : DEFAULT_ALLOWED_ORIGINS[0];
    return {
        statusCode: statusCode,
        headers: {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Cache-Control": "public, max-age=" + Number(cacheSeconds || 0),
            "Content-Type": contentType || "application/octet-stream",
            "Vary": "Origin"
        },
        isBase64Encoded: true,
        body: Buffer.from(bytes || Buffer.alloc(0)).toString("base64")
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

module.exports.testHooks = {
    ensureSocialPostingEligible: ensureSocialPostingEligible,
    validateNoLinksOrPromotion: validateNoLinksOrPromotion,
    validateFlipbookPayload: validateFlipbookPayload,
    validatePrimarySuggestionReport: validatePrimarySuggestionReport,
    primarySuggestionReportSnapshot: primarySuggestionReportSnapshot
};
