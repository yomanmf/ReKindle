"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("Books to Kindle is a Kindle-safe direct queue UI", function () {
    var html = read("bookskindle.html");
    var client = read("js/bookskindle.js");
    assert.match(html, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(html, /animation:\s*none\s*!important/);
    assert.match(html, /min-height:\s*48px/);
    assert.match(html, /<html[^>]*data-no-scale/);
    assert.match(html, /\.close-box\s*\{[^}]*width:\s*48px[^}]*height:\s*48px/s);
    assert.match(html, /\.close-box::after\s*\{[^}]*content:\s*"X"/s);
    assert.match(html, /class="title-stripes"/);
    assert.match(html, /id="error-modal"/);
    assert.doesNotMatch(html + client, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(html + client, /telegram/i);
    assert.doesNotMatch(html, /display:\s*flex[^}]*\bgap\s*:/s);
    assert.match(client, /RekindleCloud\.request\(API_PATH \+ action/);
    assert.match(client, /setInterval\([^]*8000\)/);
});

test("Books to Kindle is routed, catalogued, isolated, and released", function () {
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var backend = read("yandex/rekindle-backend/index.js");
    var service = read("yandex/rekindle-backend/books-kindle-service.js");
    var rules = read("firestore.rules");
    var catalog = read("icons-beta.js");
    var manifest = read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/);

    assert.match(gateway, /\/api\/rekindle\/books-kindle\/\{action\}/);
    assert.match(gateway, /\/api\/rekindle\/books-kindle-worker\/\{action\}/);
    assert.match(backend, /requireFirebaseUser[\s\S]*?booksKindleService\.handle/);
    assert.match(service, /BOOKS_KINDLE_ALLOWED_UIDS|KINDLE_DIGEST_ALLOWED_UIDS/);
    assert.match(service, /timingSafeEqual/);
    assert.match(rules, /match \/books_kindle_jobs\/\{jobId\}[\s\S]*?allow read, write: if false/);
    assert.match(rules, /match \/books_kindle_settings\/\{userId\}[\s\S]*?allow read, write: if false/);
    assert.match(catalog, /id:\s*['"]bookskindle['"][\s\S]{0,500}<path/);
    ["bookskindle.html", "js/bookskindle.js", "locales/bookskindle-en.json", "locales/bookskindle-ru.json"].forEach(function (file) {
        assert.ok(manifest.includes(file), file);
    });
    assert.match(read("index.html"), /icons-beta\.js\?v=6/);
    assert.match(read("index_old.html"), /icons-beta\.js\?v=6/);
    assert.match(read("sw.js"), /rekindle-cache-v41/);
});

test("Books to Kindle ships English and Russian UI contracts", function () {
    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/bookskindle-" + language + ".json"));
        ["bookskindle.title", "bookskindle.search", "bookskindle.save", "bookskindle.cancel", "bookskindle.retry"].forEach(function (key) {
            assert.ok(locale[key], language + ": " + key);
        });
    });
});
