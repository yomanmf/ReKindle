"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
var chatSource = fs.readFileSync(path.join(root, "chat.html"), "utf8");
var cloudSource = fs.readFileSync(path.join(root, "js/rekindle-cloud.js"), "utf8");

test("AI chat uses only the server-authoritative quota", function () {
    assert.doesNotMatch(chatSource, /collection\(['"]chatLimits['"]\)/);
    assert.match(chatSource, /body:\s*\{\s*action:\s*['"]quota['"]\s*\}/);
    assert.match(chatSource, /applyQuota\(data\.quota\)/);
    assert.match(chatSource, /if \(e\.quota\) applyQuota\(e\.quota\)/);
    assert.match(chatSource, /dailyMessageLimit = Math\.max\(1, quota\.limit\)/);
    assert.match(chatSource, /const hasCustomProvider = useByoKey && Boolean\(apiKey\)/);
});

test("AI chat distinguishes server, provider, timeout, session, and network errors", function () {
    [
        "unauthenticated",
        "daily-limit",
        "provider-authorization",
        "provider-rate-limit",
        "provider-request",
        "ai-timeout",
        "ai-configuration",
        "ai-capacity",
        "ai-unavailable",
        "ai-network"
    ].forEach(function (code) {
        assert.match(chatSource, new RegExp("['\"]" + code + "['\"]"));
    });
    assert.match(chatSource, /navigator\.onLine\s*===\s*false/);
    assert.match(chatSource, /error\.requestId/);
    assert.match(cloudSource, /error\.requestId\s*=\s*data\.requestId/);
    assert.match(cloudSource, /error\.quota\s*=\s*data\.quota/);
});

test("AI chat prevents duplicate sends and bounds request duration", function () {
    assert.match(chatSource, /isSendingMessage/);
    assert.match(chatSource, /AI_REQUEST_TIMEOUT_MS\s*=\s*35000/);
    assert.match(chatSource, /new AbortController\(\)/);
});

test("chat inline scripts parse as ES2019-compatible JavaScript", function () {
    var scriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    var count = 0;
    while ((match = scriptPattern.exec(chatSource)) !== null) {
        count += 1;
        assert.doesNotThrow(function () { new Function(match[1]); });
        assert.doesNotMatch(match[1], /\?\.|\?\?/);
    }
    assert.ok(count > 0);
});
