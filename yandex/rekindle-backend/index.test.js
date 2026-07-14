"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var backend = require("./index.js");
var nrlParser = require("./nrl.js");

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

test("health endpoint is available from the production origin", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/health",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true, service: "rekindle-backend" });
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
    assert.match(result.headers["Access-Control-Allow-Headers"], /X-Substack-SID/);
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

test("NRL parser returns only known NRL teams", function () {
    var html = '<header class="Card__Header" aria-label="Monday, July 13">' +
        '<div class="ScoreboardScoreCell ScoreboardScoreCell--post">' +
        '<li class="ScoreboardScoreCell__Item ScoreboardScoreCell__Item--away"><div class="ScoreCell__TeamName ScoreCell__TeamName--shortDisplayName">Broncos</div><div class="ScoreCell__Score ScoreCell_Score--scoreboard">18</div></li>' +
        '<li class="ScoreboardScoreCell__Item ScoreboardScoreCell__Item--home"><div class="ScoreCell__TeamName ScoreCell__TeamName--shortDisplayName">Raiders</div><div class="ScoreCell__Score ScoreCell_Score--scoreboard">12</div></li>' +
        '</div>';
    var events = nrlParser.parseNRLScoreboard(html);
    assert.equal(events.length, 1);
    assert.equal(events[0].status.type.shortDetail, "Final");
    assert.equal(events[0].competitions[0].competitors[0].team.shortDisplayName, "Broncos");
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

test("social eligibility depends on age verification, not supporter status", function () {
    assert.throws(function () {
        backend.testHooks.ensureSocialPostingEligible({ uid: "supporter", pro: true });
    }, function (error) {
        return error.status === 403 && error.code === "age-verification-required";
    });
    assert.doesNotThrow(function () {
        backend.testHooks.ensureSocialPostingEligible({ uid: "verified", ageVerified: true, pro: false });
    });
});

test("social validation blocks URLs and promotional service names", function () {
    assert.throws(function () {
        backend.testHooks.validateNoLinksOrPromotion("visit example.com");
    }, function (error) {
        return error.code === "links-not-allowed";
    });
    assert.throws(function () {
        backend.testHooks.validateNoLinksOrPromotion("try KindleHub today");
    }, function (error) {
        return error.code === "promotion-not-allowed";
    });
});

test("Flipbook validation keeps abuse bounds independent of subscription", function () {
    var result = backend.testHooks.validateFlipbookPayload({
        fps: 6,
        frames: ["data:image/png;base64,AA=="]
    });
    assert.equal(result.fps, 6);
    assert.equal(result.frames.length, 1);
    assert.throws(function () {
        backend.testHooks.validateFlipbookPayload({ fps: 6, frames: new Array(61).fill("data:image/png;base64,AA==") });
    }, function (error) {
        return error.status === 400 && error.code === "invalid-frames";
    });
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

test("Pinterest integration requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/integrations/pinterest/oauth",
        "https://rekindle.website.yandexcloud.net",
        { code: "test", redirect_uri: "https://rekindle.website.yandexcloud.net/pinterest.html" }
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("Substack integration requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/integrations/substack/api/subscriptions",
        "https://rekindle.website.yandexcloud.net"
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
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
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

test("mail operations require a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/mail/folders",
        "https://rekindle.website.yandexcloud.net",
        { imap: {} }
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("Flipbook posting requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/social/flipbook",
        "https://rekindle.website.yandexcloud.net",
        { flipnote_data: { fps: 6, frames: [] } }
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("TMDB proxy requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/content/tmdb/search/multi",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});

test("chord proxy requires a Firebase ID token", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/content/chords",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
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
    ["supporter checkout", "POST", "/api/rekindle/billing/checkout"],
    ["primary suggestion reports", "POST", "/api/rekindle/reports/submit"],
    ["social moderation", "POST", "/api/rekindle/social/moderate"],
    ["social translation", "POST", "/api/rekindle/social/translate"]
].forEach(function (item) {
    test(item[0] + " requires a Firebase ID token", async function () {
        var result = await backend.handler(event(item[1], item[2], "https://rekindle.website.yandexcloud.net", {}));
        assert.equal(result.statusCode, 401);
        assert.equal(JSON.parse(result.body).code, "unauthenticated");
    });
});

test("primary suggestion report payloads are restricted to canonical primary paths", function () {
    var validate = backend.testHooks.validatePrimarySuggestionReport;
    assert.deepEqual(validate({
        contentType: "suggestion",
        contentId: "suggestion_1",
        contentPath: "suggestions/suggestion_1",
        reportedUserId: "author_1",
        reason: "spam",
        comment: "Repeated content"
    }), {
        contentType: "suggestion",
        contentId: "suggestion_1",
        contentPath: "suggestions/suggestion_1",
        reportedUserId: "author_1",
        reason: "spam",
        comment: "Repeated content"
    });
    assert.throws(function () {
        validate({
            contentType: "suggestion_comment",
            contentId: "comment_1",
            contentPath: "suggestions/other/comments/comment_2",
            reportedUserId: "author_1",
            reason: "spam"
        });
    }, /Invalid suggestion comment path/);
    assert.throws(function () {
        validate({
            contentType: "topic",
            contentId: "topic_1",
            contentPath: "topics/topic_1",
            reportedUserId: "author_1",
            reason: "spam"
        });
    }, /Invalid primary report type/);
});

test("primary suggestion report snapshots are derived from stored content", function () {
    assert.equal(
        backend.testHooks.primarySuggestionReportSnapshot("suggestion", { title: "Title", description: "Description" }),
        "Title - Description"
    );
    assert.equal(
        backend.testHooks.primarySuggestionReportSnapshot("suggestion_comment", { text: "Stored comment" }),
        "Stored comment"
    );
});
