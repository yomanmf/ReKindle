"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function manifestEntries(relativePath) {
    return read(relativePath).split(/\r?\n/).map(function (line) {
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

test("retired internal-social files and Firebase configuration are absent", function () {
    [
        "kindlechat.html",
        "neighbourhood.html",
        "topics.html",
        "moderation.html",
        "firebase-social.json",
        "firestore-social.rules",
        "rtdb-social-rules.json",
        "js/age-verification.js"
    ].forEach(function (relativePath) {
        assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
    });
});

test("Pixel and Flipbook are primary-project standalone editors", function () {
    var pixel = read("pixel.html");
    var flipbook = read("flipbook.html");

    assert.match(pixel, /collection\(['"]pixel_drawings['"]\)/);
    assert.match(flipbook, /collection\(['"]flipnote_animations['"]\)/);
    assert.match(pixel, /Local-only mode when the Firebase CDN is unavailable/);
    assert.match(flipbook, /Local-only mode when the Firebase CDN is unavailable/);
    assert.doesNotMatch(flipbook, /onclick=['"]downloadGIF\(\)['"][^>]*\bdisabled\b/);
    [pixel, flipbook].forEach(function (source) {
        assert.doesNotMatch(source, /rekindle-socials|getSocialToken|socialAuth|firebase-database|firebase-functions|\/social\//i);
    });

    assertInlineScriptsParse("pixel.html");
    assertInlineScriptsParse("flipbook.html");
});

test("runtime configuration exposes no internal-social backend", function () {
    var backend = read("yandex/rekindle-backend/index.js");
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var functions = read("firebase-functions/index.js");
    var primaryRules = read("rtdb-rules.json") + "\n" + read("firestore.rules");

    [backend, gateway, functions, primaryRules].forEach(function (source) {
        assert.doesNotMatch(source, /rekindle-socials|getSocialToken|socialFirebase|\/social\/|kindlechat|user_cards|users_public|age_verification_sessions/i);
    });
});

test("catalog and locale bundles do not advertise retired applications", function () {
    var catalog = read("icons.js");
    assert.doesNotMatch(catalog, /\b(?:kindlechat|neighbourhood|topics)\b/i);

    ["index.html", "life.html", "suggestions.html"].forEach(assertInlineScriptsParse);

    fs.readdirSync(path.join(root, "locales")).filter(function (name) {
        return /^(?:de|en|es|fr|it|pl|pt|ru|vi|zh)\.json$/.test(name);
    }).forEach(function (name) {
        var locale = JSON.parse(read(path.join("locales", name)));
        Object.keys(locale).forEach(function (key) {
            assert.doesNotMatch(key, /^(?:app\.)?(?:kindlechat|neighbourhood|topics)\./i, name + ": " + key);
        });
    });
});

test("release publishes editors and deletes stale social page objects", function () {
    var release = manifestEntries("yandex/FRONTEND-RELEASE-MANIFEST.txt");
    var deleted = manifestEntries("yandex/FRONTEND-DELETE-MANIFEST.txt");

    assert.ok(release.includes("pixel.html"));
    assert.ok(release.includes("flipbook.html"));
    assert.ok(release.includes("sw.js"));
    ["kindlechat", "neighbourhood", "topics", "moderation"].forEach(function (name) {
        assert.ok(deleted.includes(name));
        assert.ok(deleted.includes(name + ".html"));
        assert.equal(release.includes(name + ".html"), false);
    });
});
