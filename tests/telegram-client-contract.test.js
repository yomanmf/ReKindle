"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function manifestEntries() {
    return read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/).map(function (line) {
        return line.trim();
    }).filter(function (line) {
        return line && line.charAt(0) !== "#";
    });
}

function assertInlineScriptsParse(relativePath) {
    var source = read(relativePath);
    var scriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    var count = 0;
    while ((match = scriptPattern.exec(source)) !== null) {
        count += 1;
        assert.doesNotThrow(function () { new Function(match[1]); }, relativePath);
        assert.doesNotMatch(match[1], /\?\.|\?\?/, relativePath + " must remain ES2019-compatible");
    }
    assert.ok(count > 0, relativePath + " should contain an inline application script");
}

test("Telegram page follows the Kindle browser contract", function () {
    var source = read("telegram.html");
    var client = read("js/telegram.js");

    assertInlineScriptsParse("telegram.html");
    assert.doesNotThrow(function () { new Function(client); });
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
    assert.doesNotMatch(source, /display\s*:\s*flex[^}]*\bgap\s*:/i);
    assert.match(source, /transition:\s*none\s*!important/);
    assert.match(source, /animation:\s*none\s*!important/);
    assert.match(source, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(source, /min-height:\s*48px/);
    assert.match(source, /class="title-stripes"/);
    assert.match(source, /class="close-box"/);
    assert.match(source, /id="error-modal"/);
    assert.match(source, /id="logout-modal"/);
    assert.match(source, /single-account/);
    assert.match(source, /id="auth-proxy-enabled"/);
    assert.match(source, /id="settings-proxy-secret"/);
    assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(client, /[\u{1F300}-\u{1FAFF}]/u);
});

test("Telegram uses the authenticated ReKindle MTProto API", function () {
    var source = read("telegram.html");
    var client = read("js/telegram.js");
    var backend = read("yandex/rekindle-backend/telegram-service.js");
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var rules = read("firestore.rules");
    var backendPackage = JSON.parse(read("yandex/rekindle-backend/package.json"));

    assert.match(source, /firebase-auth-compat\.js/);
    assert.match(source, /js\/rekindle-cloud\.js/);
    assert.match(client, /RekindleCloud\.request\("\/telegram\/"\s*\+\s*action/);
    ["status", "start", "email-start", "email-confirm", "confirm", "password", "chats", "messages", "send", "read", "proxy", "logout"].forEach(function (action) {
        assert.match(gateway, new RegExp("\\b" + action.replace("-", "\\-") + "\\b"));
    });
    assert.match(gateway, /\/api\/rekindle\/telegram\/\{action\}/);
    assert.equal(backendPackage.dependencies.teleproto, "1.227.1");
    assert.match(backend, /aes-256-gcm/);
    assert.match(backend, /TELEGRAM_SESSION_ENCRYPTION_KEY/);
    assert.match(backend, /TELEGRAM_API_ID/);
    assert.match(backend, /TELEGRAM_API_HASH/);
    assert.match(backend, /validateProxyConfig/);
    assert.match(backend, /isPrivateAddress/);
    assert.match(backend, /var proxy = await validateProxyConfig\(body\.proxy\);[\s\S]*?createClient\("", env, proxy\)[\s\S]*?client\.sendCode/);
    assert.match(client, /request\("start",\s*\{[\s\S]*?proxy:\s*readProxyForm\("auth"\)/);
    assert.match(rules, /match \/telegram_sessions\/\{userId\}[\s\S]*?allow read, write: if false/);
    assert.match(client, /demo=1/);
    assert.doesNotMatch(source + client, /Beeper Desktop|beeper_token|workers\.dev/i);
    assert.doesNotMatch(client, /localStorage\.setItem|sessionStorage\.setItem/);
});

test("Telegram is present in the catalog, release, and locale contracts", function () {
    var catalog = read("icons.js");
    assert.match(catalog, /id:\s*['"]telegram['"]/);
    assert.match(catalog, /cat:\s*['"]lifestyle['"]/);
    assert.doesNotMatch(catalog.match(/\{\s*id:\s*['"]telegram['"][\s\S]*?\n\s*\}/)[0], /plus:\s*true/);
    assert.ok(manifestEntries().includes("telegram.html"));
    assert.ok(manifestEntries().includes("js/telegram.js"));

    ["de", "en", "es", "fr", "it", "pl", "pt", "ru", "vi", "zh"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        assert.ok(locale["app.telegram.name"], language + " app name");
        assert.ok(locale["app.telegram.desc"], language + " app description");
        var privacy = JSON.parse(read("locales/privacy-" + language + ".json"));
        assert.match(privacy["privacy.intro"], /MTProto/i, language + " privacy disclosure");
        assert.doesNotMatch(privacy["privacy.intro"], /Beeper Desktop/i, language + " stale privacy disclosure");
    });

    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        [
            "telegram.setup.title",
            "telegram.setup.security",
            "telegram.auth.phone_title",
            "telegram.auth.password_title",
            "telegram.proxy.settings",
            "telegram.toolbar.search",
            "telegram.state.loading_chats",
            "telegram.chat.send",
            "telegram.error.connection"
        ].forEach(function (key) {
            assert.ok(locale[key], language + ": " + key);
        });
    });
});

test("shared extensionless URL cleanup preserves query and hash state", function () {
    var theme = read("theme.js");
    assert.match(theme, /window\.location\.pathname\.replace\(['"]\.html['"],\s*['"]['"]\)\s*\+\s*window\.location\.search\s*\+\s*window\.location\.hash/);
});
