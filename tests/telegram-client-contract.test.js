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

    assertInlineScriptsParse("telegram.html");
    assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
    assert.doesNotMatch(source, /display\s*:\s*flex[^}]*\bgap\s*:/i);
    assert.match(source, /transition:\s*none\s*!important/);
    assert.match(source, /animation:\s*none\s*!important/);
    assert.match(source, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(source, /min-height:\s*48px/);
    assert.match(source, /class="title-stripes"/);
    assert.match(source, /class="close-box"/);
    assert.match(source, /id="error-modal"/);
    assert.match(source, /single-account/);
    assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u);
});

test("Telegram uses the direct Beeper v1 API and keeps credentials local", function () {
    var source = read("telegram.html");

    assert.match(source, /"\/v1\/accounts"/);
    assert.match(source, /"\/v1\/chats\/search\?"/);
    assert.match(source, /"\/v1\/chats\/"\s*\+\s*encodeURIComponent\(getChatId\(this\.currentChat\)\)\s*\+\s*"\/messages"/);
    assert.match(source, /"Authorization":\s*"Bearer "\s*\+\s*this\.token/);
    assert.match(source, /bridge\.type/);
    assert.match(source, /localStorage\.setItem\(STORAGE_TOKEN/);
    assert.match(source, /sessionStorage\.setItem\(SESSION_TOKEN/);
    assert.match(source, /demo=1/);
    assert.doesNotMatch(source, /RekindleCloud|firebase\.initializeApp|firebasejs|firestore|workers\.dev/i);
    assert.doesNotMatch(source, /X-Firebase-Token/);
});

test("Telegram is present in the catalog, release, and locale contracts", function () {
    var catalog = read("icons.js");
    assert.match(catalog, /id:\s*['"]telegram['"]/);
    assert.match(catalog, /cat:\s*['"]lifestyle['"]/);
    assert.doesNotMatch(catalog.match(/\{\s*id:\s*['"]telegram['"][\s\S]*?\n\s*\}/)[0], /plus:\s*true/);
    assert.ok(manifestEntries().includes("telegram.html"));

    ["de", "en", "es", "fr", "it", "pl", "pt", "ru", "vi", "zh"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        assert.ok(locale["app.telegram.name"], language + " app name");
        assert.ok(locale["app.telegram.desc"], language + " app description");
        var privacy = JSON.parse(read("locales/privacy-" + language + ".json"));
        assert.match(privacy["privacy.intro"], /Beeper Desktop/i, language + " privacy disclosure");
    });

    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        [
            "telegram.setup.title",
            "telegram.setup.security",
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
