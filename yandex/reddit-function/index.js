"use strict";

// Warm-instance cache. It reduces repeated Reddit requests while the Yandex
// Cloud Function instance remains alive and can serve stale data during a
// temporary upstream rate limit. No Cloudflare-specific APIs are used.
var responseCache = new Map();
var CACHE_MAX_ENTRIES = 80;
var CACHE_MAX_BYTES = 20 * 1024 * 1024;
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
var STALE_TTL_MS = 24 * 60 * 60 * 1000;
var cacheBytes = 0;

var ALLOWED_HOSTS = [
    "reddit.com",
    "old.reddit.com",
    "api.reddit.com",
    "www.reddit.com",
    "redd.it",
    "i.redd.it",
    "preview.redd.it",
    "v.redd.it",
    "imgur.com",
    "i.imgur.com"
];

var BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "Accept": "application/atom+xml,application/rss+xml,application/json,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.reddit.com/"
};

module.exports.handler = async function (event) {
    event = event || {};
    var method = String(event.httpMethod || "GET").toUpperCase();

    if (method === "OPTIONS") {
        return makeResponse(204, "", "text/plain; charset=utf-8", false, 0);
    }

    if (method !== "GET" && method !== "HEAD") {
        return makeResponse(405, "Method not allowed", "text/plain; charset=utf-8", false, 0);
    }

    var query = event.queryStringParameters || {};
    var targetUrl = query.url;
    if (!targetUrl) {
        return makeResponse(400, "Missing url param", "text/plain; charset=utf-8", false, 0);
    }

    var target;
    try {
        target = new URL(targetUrl);
    } catch (e) {
        return makeResponse(400, "Invalid URL", "text/plain; charset=utf-8", false, 0);
    }

    if (target.protocol !== "https:" || target.username || target.password || !isAllowedHost(target.hostname)) {
        return makeResponse(403, "Forbidden: Domain not allowed", "text/plain; charset=utf-8", false, 0);
    }
    target.hash = "";
    targetUrl = target.toString();

    var now = Date.now();
    var cached = responseCache.get(targetUrl);
    if (cached && cached.expiresAt > now) {
        return responseFromCache(cached, method, false);
    }

    var isFeed = endsWith(target.pathname, ".rss") || endsWith(target.pathname, ".json");
    var isImage = /\.(jpeg|jpg|png|gif|webp|avif)($|\?)/i.test(target.pathname + target.search);
    var maxAge = isImage ? 3600 : isFeed ? 600 : 60;
    var urlsToTry = [targetUrl];

    if (endsWith(target.pathname, ".rss") &&
        (target.hostname === "www.reddit.com" || target.hostname === "reddit.com")) {
        var oldUrl = new URL(targetUrl);
        oldUrl.hostname = "old.reddit.com";
        urlsToTry.unshift(oldUrl.toString());
    }

    var lastStatus = 0;
    var lastError = null;

    for (var urlIndex = 0; urlIndex < urlsToTry.length; urlIndex++) {
        var urlToFetch = urlsToTry[urlIndex];

        for (var attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) {
                await sleep(Math.min(1000 * Math.pow(2, attempt), 5000));
            }

            try {
                var upstream = await fetchAllowedUrl(urlToFetch, method);
                lastStatus = upstream.status;

                if (upstream.status === 200) {
                    var contentType = upstream.headers.get("content-type") || "application/octet-stream";
                    if (isFeed && contentType.toLowerCase().indexOf("text/html") !== -1) {
                        lastError = new Error("Reddit returned HTML instead of feed data");
                        break;
                    }

                    if (method === "HEAD") {
                        return makeResponse(200, "", contentType, false, maxAge);
                    }
                    var buffer = await readLimitedBytes(upstream, MAX_RESPONSE_BYTES);
                    var binary = isBinaryContent(contentType, isImage);
                    var body = binary ? buffer.toString("base64") : buffer.toString("utf8");
                    var entry = {
                        body: body,
                        contentType: contentType,
                        isBase64Encoded: binary,
                        byteLength: buffer.length,
                        maxAge: maxAge,
                        expiresAt: Date.now() + maxAge * 1000,
                        staleUntil: Date.now() + STALE_TTL_MS
                    };

                    putCache(targetUrl, entry);
                    return responseFromCache(entry, method, false);
                }

                if (upstream.status !== 429 && upstream.status < 500) {
                    break;
                }
            } catch (e) {
                lastError = e;
                if (e && e.nonRetryable === true) attempt = 3;
            }
        }
    }

    if (cached && cached.staleUntil > now) {
        return responseFromCache(cached, method, true);
    }

    var message = lastError ? lastError.message : "Reddit upstream returned status " + (lastStatus || 502);
    return makeResponse(lastStatus === 429 ? 429 : 502, message, "text/plain; charset=utf-8", false, 0);
};

function isAllowedHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    for (var i = 0; i < ALLOWED_HOSTS.length; i++) {
        var allowed = ALLOWED_HOSTS[i];
        if (host === allowed || endsWith(host, "." + allowed)) return true;
    }
    return false;
}

async function fetchAllowedUrl(value, method) {
    var current = validateAllowedUrl(value);
    for (var redirect = 0; redirect < 5; redirect++) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 15000);
        var upstream;
        try {
            upstream = await fetch(current.toString(), {
                method: method,
                headers: BROWSER_HEADERS,
                redirect: "manual",
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }
        if (upstream.status < 300 || upstream.status >= 400) return upstream;
        var location = upstream.headers.get("location");
        if (!location) throw terminalError("Reddit returned an invalid redirect");
        current = validateAllowedUrl(new URL(location, current).toString());
    }
    throw terminalError("Reddit redirected too many times");
}

function validateAllowedUrl(value) {
    var parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !isAllowedHost(parsed.hostname)) {
        throw terminalError("Redirect target is not allowed");
    }
    parsed.hash = "";
    return parsed;
}

async function readLimitedBytes(upstream, maxBytes) {
    var length = Number(upstream.headers.get("content-length") || 0);
    if (length > maxBytes) throw terminalError("Reddit response exceeds the 5 MB limit");
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
            throw terminalError("Reddit response exceeds the 5 MB limit");
        }
        chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks, total);
}

function terminalError(message) {
    var error = new Error(message);
    error.nonRetryable = true;
    return error;
}

function isBinaryContent(contentType, isImage) {
    var type = String(contentType || "").toLowerCase();
    return isImage || type.indexOf("image/") === 0 || type.indexOf("video/") === 0 || type.indexOf("application/octet-stream") === 0;
}

function putCache(key, value) {
    var previous = responseCache.get(key);
    if (previous) {
        cacheBytes -= Number(previous.byteLength || 0);
        responseCache.delete(key);
    }
    while (responseCache.size >= CACHE_MAX_ENTRIES || (responseCache.size && cacheBytes + value.byteLength > CACHE_MAX_BYTES)) {
        var oldestKey = responseCache.keys().next().value;
        if (!oldestKey) break;
        var oldest = responseCache.get(oldestKey);
        cacheBytes -= Number(oldest && oldest.byteLength || 0);
        responseCache.delete(oldestKey);
    }
    if (value.byteLength > CACHE_MAX_BYTES) return;
    responseCache.set(key, value);
    cacheBytes += value.byteLength;
}

function responseFromCache(entry, method, stale) {
    var response = makeResponse(
        200,
        method === "HEAD" ? "" : entry.body,
        entry.contentType,
        entry.isBase64Encoded && method !== "HEAD",
        entry.maxAge
    );
    if (stale) response.headers.Warning = '110 - "Response is stale"';
    return response;
}

function makeResponse(statusCode, body, contentType, isBase64Encoded, maxAge) {
    return {
        statusCode: statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Cache-Control": maxAge > 0 ? "public, max-age=" + maxAge : "no-store",
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff"
        },
        isBase64Encoded: !!isBase64Encoded,
        body: body || ""
    };
}

function endsWith(value, suffix) {
    value = String(value || "");
    return value.slice(-suffix.length) === suffix;
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}
