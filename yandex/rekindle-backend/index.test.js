"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var backend = require("./index.js");
var telegramService = require("./telegram-service.js");
var teleproto = require("teleproto");

function event(method, path, origin, body) {
    return {
        httpMethod: method,
        path: path,
        headers: origin ? { Origin: origin } : {},
        requestContext: { identity: { sourceIp: "203.0.113.10" } },
        body: body === undefined ? "" : JSON.stringify(body),
        isBase64Encoded: false
    };
}

function transactionRef(initialValue) {
    var value = initialValue;
    return {
        transaction: async function (update) {
            var current = value === null || value === undefined
                ? value
                : JSON.parse(JSON.stringify(value));
            var next = update(current);
            if (next === undefined) {
                return { committed: false, snapshot: { val: function () { return value; } } };
            }
            value = next;
            return { committed: true, snapshot: { val: function () { return value; } } };
        },
        value: function () { return value; }
    };
}

test("health endpoint is available from the production origin", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/health",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true, service: "rekindle-backend" });
});

test("browser analytics validates the origin and forwards a sanitized event", async function () {
    var originalFetch = global.fetch;
    var originalUrl = process.env.ANALYTICS_URL;
    var originalToken = process.env.ANALYTICS_INGEST_TOKEN;
    process.env.ANALYTICS_URL = "https://analytics.example";
    process.env.ANALYTICS_INGEST_TOKEN = "secret-token";
    var forwarded;
    global.fetch = async function (url, options) {
        forwarded = { url: url, options: options, body: JSON.parse(options.body) };
        return new Response("{}", { status: 202 });
    };
    try {
        var result = await backend.handler(event(
            "POST",
            "/api/rekindle/analytics/events",
            "https://tetra.website.yandexcloud.net",
            {
                eventId: "tetra:session_1",
                sourceId: "tetra",
                userId: "anon_1",
                requestType: "game_finished",
                requestText: "Game session",
                resultText: "Score 1200, lines 4",
                status: "success",
                durationMs: 42000,
                metadata: { score: 1200, lines: 4 }
            }
        ));
        assert.equal(result.statusCode, 202);
        assert.equal(forwarded.url, "https://analytics.example/analytics/events");
        assert.equal(forwarded.options.headers.Authorization, "Bearer secret-token");
        assert.equal(forwarded.body.botId, "tetra");
        assert.equal(forwarded.body.userId, "anon_1");
        assert.equal(forwarded.body.resultText, "Score 1200, lines 4");

        var mismatch = await backend.handler(event(
            "POST",
            "/api/rekindle/analytics/events",
            "https://rekindle.website.yandexcloud.net",
            { eventId: "tetra:bad", sourceId: "tetra", userId: "anon_1", requestType: "page_view", status: "success" }
        ));
        assert.equal(mismatch.statusCode, 400);
    } finally {
        global.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.ANALYTICS_URL;
        else process.env.ANALYTICS_URL = originalUrl;
        if (originalToken === undefined) delete process.env.ANALYTICS_INGEST_TOKEN;
        else process.env.ANALYTICS_INGEST_TOKEN = originalToken;
    }
});

test("preflight includes application authentication headers", async function () {
    var result = await backend.handler(event(
        "OPTIONS",
        "/api/rekindle/storage/list",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 204);
    assert.match(result.headers["Access-Control-Allow-Headers"], /X-Firebase-Token/);
    assert.match(result.headers["Access-Control-Allow-Headers"], /Authorization/);
    assert.match(result.headers["Access-Control-Allow-Headers"], /X-Readwise-Token/);
});

test("unapproved browser origins are rejected", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/health",
        "https://attacker.example"
    ));
    assert.equal(result.statusCode, 403);
});

test("public content proxy validates its target before backend credentials", async function () {
    var missing = event("GET", "/api/rekindle/content/proxy", "https://rekindle.website.yandexcloud.net");
    missing.queryStringParameters = {};
    var missingResult = await backend.handler(missing);
    assert.equal(missingResult.statusCode, 400);
    assert.equal(JSON.parse(missingResult.body).code, "invalid-target");

    var local = event("GET", "/api/rekindle/content/proxy", "https://rekindle.website.yandexcloud.net");
    local.queryStringParameters = { url: "http://localhost/private" };
    var localResult = await backend.handler(local);
    assert.equal(localResult.statusCode, 400);
    assert.equal(JSON.parse(localResult.body).code, "invalid-target");
});

test("public content proxy returns bounded binary responses", async function () {
    var originalFetch = global.fetch;
    global.fetch = async function () {
        return new Response(Buffer.from([0, 1, 2, 255]), { status: 200, headers: { "Content-Type": "image/png", "Content-Length": "4" } });
    };
    try {
        var proxyEvent = event("GET", "/api/rekindle/content/proxy", "https://rekindle.website.yandexcloud.net");
        proxyEvent.queryStringParameters = { url: "https://93.184.216.34/image.png" };
        proxyEvent.requestContext.skipProxyRateLimit = true;
        var result = await backend.handler(proxyEvent);
        assert.equal(result.statusCode, 200);
        assert.equal(result.isBase64Encoded, true);
        assert.equal(result.headers["Content-Type"], "image/png");
        assert.deepEqual(Buffer.from(result.body, "base64"), Buffer.from([0, 1, 2, 255]));
    } finally {
        global.fetch = originalFetch;
    }
});

test("reader routes Reddit pages through the stable old Reddit HTML interface", function () {
    var normalize = backend.testHooks.normalizeReaderTargetUrl;
    assert.equal(
        normalize("https://www.reddit.com/r/MadeMeSmile/comments/abc123/example/?utm_source=test#comments"),
        "https://old.reddit.com/r/MadeMeSmile/comments/abc123/example/?utm_source=test#comments"
    );
    assert.equal(
        normalize("https://reddit.com/r/test/comments/abc123/example/"),
        "https://old.reddit.com/r/test/comments/abc123/example/"
    );
    assert.equal(
        normalize("https://notreddit.com/article"),
        "https://notreddit.com/article"
    );
});

test("registration validates input before accessing credentials", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/auth/register",
        "https://rekindle.website.yandexcloud.net",
        { username: "admin", password: "123456" }
    ));
    assert.equal(result.statusCode, 400);
    assert.equal(JSON.parse(result.body).code, "invalid-argument");
});

test("storage requires a Firebase ID token", async function () {
    var storageEvent = event(
        "GET",
        "/api/rekindle/storage/list",
        "https://rekindle.website.yandexcloud.net"
    );
    storageEvent.queryStringParameters = { folder: "files" };
    var result = await backend.handler(storageEvent);
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("Microsoft To Do integration requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/microsoft-todo/status",
        "https://rekindle.website.yandexcloud.net",
        {}
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("AI chat requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/ai/chat",
        "https://rekindle.website.yandexcloud.net",
        { prompt: "hello" }
    ));
    assert.equal(result.statusCode, 401);
    var body = JSON.parse(result.body);
    assert.equal(body.code, "unauthenticated");
    assert.match(body.requestId, /^[a-zA-Z0-9._:-]+$/);
});

test("Yandex AI returns text through the service-account token", async function () {
    var originalFetch = global.fetch;
    var originalFolder = process.env.YANDEX_FOLDER_ID;
    process.env.YANDEX_FOLDER_ID = "folder-test";
    global.fetch = async function (url, options) {
        assert.equal(url, "https://llm.api.cloud.yandex.net/foundationModels/v1/completion");
        assert.equal(options.headers.Authorization, "Bearer iam-test-token");
        assert.equal(options.headers["x-folder-id"], "folder-test");
        var request = JSON.parse(options.body);
        assert.equal(request.modelUri, "gpt://folder-test/yandexgpt-lite/latest");
        return new Response(JSON.stringify({
            result: { alternatives: [{ message: { text: "Hello from YandexGPT" } }] }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
        var result = await backend.testHooks.generateWithYandex({ token: { access_token: "iam-test-token" } }, "hello");
        assert.deepEqual(result, { text: "Hello from YandexGPT" });
    } finally {
        global.fetch = originalFetch;
        if (originalFolder === undefined) delete process.env.YANDEX_FOLDER_ID;
        else process.env.YANDEX_FOLDER_ID = originalFolder;
    }
});

test("Yandex AI maps permission and capacity failures to stable error codes", async function () {
    var originalFetch = global.fetch;
    var originalFolder = process.env.YANDEX_FOLDER_ID;
    process.env.YANDEX_FOLDER_ID = "folder-test";
    try {
        global.fetch = async function () {
            return new Response(JSON.stringify({ error: { message: "Permission denied" } }), { status: 403 });
        };
        await assert.rejects(
            backend.testHooks.generateWithYandex({ token: { access_token: "iam-test-token" } }, "hello"),
            function (error) {
                return error.status === 503 && error.code === "ai-configuration" && error.upstreamStatus === 403;
            }
        );

        global.fetch = async function () {
            return new Response(JSON.stringify({ error: { message: "Too many requests" } }), {
                status: 429,
                headers: { "Retry-After": "7" }
            });
        };
        await assert.rejects(
            backend.testHooks.generateWithYandex({ token: { access_token: "iam-test-token" } }, "hello"),
            function (error) {
                return error.status === 503 && error.code === "ai-capacity" && error.retryAfter === 7;
            }
        );
    } finally {
        global.fetch = originalFetch;
        if (originalFolder === undefined) delete process.env.YANDEX_FOLDER_ID;
        else process.env.YANDEX_FOLDER_ID = originalFolder;
    }
});

test("AI upstream requests have a bounded timeout", async function () {
    var originalFetch = global.fetch;
    global.fetch = function (url, options) {
        return new Promise(function (resolve, reject) {
            options.signal.addEventListener("abort", function () {
                var error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            });
        });
    };
    try {
        await assert.rejects(
            backend.testHooks.fetchWithTimeout("https://example.com", {}, 5),
            function (error) { return error.status === 504 && error.code === "ai-timeout"; }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("AI quota reservation is atomic and can be released", async function () {
    var now = new Date("2026-07-15T12:00:00Z");
    var ref = transactionRef(null);
    var reservation = await backend.testHooks.reserveDailyLimitRef(ref, 10, "2026-07-15", now);
    assert.equal(reservation.quota.used, 1);
    assert.equal(reservation.quota.remaining, 9);
    assert.equal(ref.value().count, 1);

    await backend.testHooks.releaseDailyLimitRef(ref);
    assert.equal(ref.value().count, 0);

    var exhausted = transactionRef({ count: 10 });
    await assert.rejects(
        backend.testHooks.reserveDailyLimitRef(exhausted, 10, "2026-07-15", now),
        function (error) {
            return error.status === 429 && error.code === "daily-limit" && error.quota.remaining === 0;
        }
    );
});

test("failed AI generation releases its reserved quota", async function () {
    var releases = 0;
    await assert.rejects(
        backend.testHooks.withReservedDailyLimit(
            async function () { return { day: "2026-07-15", quota: { limit: 10, used: 1, remaining: 9 } }; },
            async function () { releases += 1; },
            async function () { throw Object.assign(new Error("provider failed"), { code: "ai-unavailable" }); }
        ),
        function (error) { return error.code === "ai-unavailable"; }
    );
    assert.equal(releases, 1);
});

test("OCR requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/ai/ocr",
        "https://rekindle.website.yandexcloud.net",
        { image: "dGVzdA==" }
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("Telegram operations require a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/telegram/status",
        "https://rekindle.website.yandexcloud.net",
        {}
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("Telegram sessions use authenticated encryption bound to the Firebase user", function () {
    var key = Buffer.alloc(32, 7);
    var encrypted = telegramService.testHooks.encryptObject(
        { stringSession: "private-session" },
        key,
        telegramService.testHooks.sessionAad("user-a")
    );
    assert.equal(encrypted.version, 1);
    assert.doesNotMatch(encrypted.ciphertext, /private-session/);
    assert.deepEqual(
        telegramService.testHooks.decryptObject(encrypted, key, telegramService.testHooks.sessionAad("user-a")),
        { stringSession: "private-session" }
    );
    assert.throws(function () {
        telegramService.testHooks.decryptObject(encrypted, key, telegramService.testHooks.sessionAad("user-b"));
    });
});

test("Telegram chat references are signed and reject tampering", function () {
    var key = Buffer.alloc(32, 11);
    var peer = new teleproto.Api.InputPeerChannel({ channelId: "123456", accessHash: "987654321" });
    var chatRef = telegramService.testHooks.signPeerRef(peer, key);
    var restored = telegramService.testHooks.inputPeerFromRef(chatRef, key);
    assert.ok(restored instanceof teleproto.Api.InputPeerChannel);
    assert.equal(restored.channelId.toString(), "123456");
    assert.equal(restored.accessHash.toString(), "987654321");
    assert.throws(function () {
        telegramService.testHooks.inputPeerFromRef(chatRef.slice(0, -1) + "A", key);
    }, /Invalid Telegram chat reference/);
});

test("Telegram validation and upstream errors have stable public codes", function () {
    assert.equal(telegramService.testHooks.validatePhone("+1 (202) 555-0123"), "+12025550123");
    assert.throws(function () { telegramService.testHooks.validatePhone("555"); }, /international format/);
    var flood = telegramService.testHooks.mapTelegramError({ errorMessage: "FLOOD_WAIT_37" });
    assert.equal(flood.status, 429);
    assert.equal(flood.code, "telegram-rate-limited");
    assert.equal(flood.retryAfter, 37);
    assert.equal(
        telegramService.testHooks.mapTelegramError({ errorMessage: "AUTH_KEY_UNREGISTERED" }).code,
        "telegram-session-expired"
    );
});

test("MTProxy secrets are validated and private destinations are rejected", function () {
    assert.equal(
        telegramService.testHooks.validateProxySecret("0123456789abcdef0123456789abcdef"),
        "0123456789abcdef0123456789abcdef"
    );
    assert.equal(
        telegramService.testHooks.validateProxySecret("dd0123456789abcdef0123456789abcdef"),
        "dd0123456789abcdef0123456789abcdef"
    );
    assert.throws(function () {
        telegramService.testHooks.validateProxySecret("short");
    }, /valid MTProxy secret/);
    ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "198.18.0.1", "203.0.113.10", "::1", "fd00::1", "2001:db8::1"].forEach(function (address) {
        assert.equal(telegramService.testHooks.isPrivateAddress(address), true, address);
    });
    assert.equal(telegramService.testHooks.isPrivateAddress("1.1.1.1"), false);
});

test("retired social endpoints are not routed", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/social/moderate",
        "https://rekindle.website.yandexcloud.net",
        {}
    ));
    assert.equal(result.statusCode, 404);
    assert.equal(JSON.parse(result.body).error, "Endpoint not found.");
});

[
    ["Pinterest", "POST", "/api/rekindle/integrations/pinterest/oauth"],
    ["Substack", "GET", "/api/rekindle/integrations/substack/api/subscriptions"],
    ["TMDB", "GET", "/api/rekindle/content/tmdb/search/multi"],
    ["chords", "GET", "/api/rekindle/content/chords"],
    ["NRL scores", "GET", "/api/rekindle/content/nrl-scores"],
    ["mail", "POST", "/api/rekindle/mail/folders"],
    ["Suggestions reports", "POST", "/api/rekindle/reports/submit"]
].forEach(function (item) {
    test("retired " + item[0] + " endpoint is not routed", async function () {
        var result = await backend.handler(event(item[1], item[2], "https://rekindle.website.yandexcloud.net", {}));
        assert.equal(result.statusCode, 404);
        assert.equal(JSON.parse(result.body).error, "Endpoint not found.");
    });
});

test("Readwise proxy requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/integrations/readwise/auth",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

[
    ["reader", "GET", "/api/rekindle/content/reader"],
    ["Akinator", "POST", "/api/rekindle/games/akinator/start"],
    ["supporter checkout", "POST", "/api/rekindle/billing/checkout"]
].forEach(function (item) {
    test(item[0] + " requires a Firebase ID token", async function () {
        var result = await backend.handler(event(item[1], item[2], "https://rekindle.website.yandexcloud.net", {}));
        assert.equal(result.statusCode, 401);
        assert.equal(JSON.parse(result.body).code, "unauthenticated");
    });
});
