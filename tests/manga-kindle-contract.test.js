"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("Manga to Kindle is a Kindle-safe direct control UI", function () {
    var html = read("mangakindle.html");
    var client = read("js/mangakindle.js");
    assert.match(html, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(html, /animation:\s*none\s*!important/);
    assert.match(html, /min-height:\s*48px/);
    assert.match(html, /class="title-stripes"/);
    assert.match(html, /id="error-modal"/);
    assert.doesNotMatch(html + client, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(html + client, /telegram/i);
    assert.doesNotMatch(html + client, /amazon|kindle-connect|kindle-status/i);
    assert.doesNotMatch(html, /display:\s*flex[^}]*\bgap\s*:/s);
    assert.match(client, /RekindleCloud\.request\(API_PATH \+ action/);
    assert.match(client, /setInterval\([^]*10000\)/);
});

test("Manga to Kindle is routed, catalogued, and released", function () {
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var backend = read("yandex/rekindle-backend/index.js");
    var service = read("yandex/rekindle-backend/manga-kindle-service.js");
    var catalog = read("icons-beta.js");
    var manifest = read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/);
    assert.match(gateway, /\/api\/rekindle\/manga-kindle\/\{action\}/);
    assert.match(backend, /requireFirebaseUser[\s\S]*?mangaKindleService\.handle/);
    assert.match(service, /MANGA_KINDLE_ALLOWED_UIDS/);
    assert.doesNotMatch(gateway + service, /kindle-connect|kindle-status/);
    assert.match(catalog, /id:\s*['"]mangakindle['"]/);
    assert.doesNotMatch(catalog, /id:\s*['"]mangakindle['"][\s\S]{0,160}beta:\s*true/);
    ["mangakindle.html", "js/mangakindle.js", "locales/mangakindle-en.json", "locales/mangakindle-ru.json"].forEach(function (file) {
        assert.ok(manifest.includes(file), file);
    });
    assert.match(read("index.html"), /icons-beta\.js\?v=5/);
    assert.match(read("index_old.html"), /icons-beta\.js\?v=5/);
    assert.match(read("sw.js"), /rekindle-cache-v40/);
});

test("Manga to Kindle ships English and Russian UI contracts", function () {
    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/mangakindle-" + language + ".json"));
        ["mangakindle.title", "mangakindle.search", "mangakindle.send", "mangakindle.cancel", "mangakindle.retry"].forEach(function (key) {
            assert.ok(locale[key], language + ": " + key);
        });
    });
});
