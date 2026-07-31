"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("Kindle Digest is a Kindle-safe direct control UI", function () {
    var html = read("kindledigest.html");
    var client = read("js/kindledigest.js");
    assert.match(html, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(html, /animation:\s*none\s*!important/);
    assert.match(html, /min-height:\s*48px/);
    assert.match(html, /class="title-stripes"/);
    assert.match(html, /class="close-box"/);
    assert.match(html, /id="error-modal"/);
    assert.doesNotMatch(html + client, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(html, /display:\s*flex[^}]*\bgap\s*:/s);
    assert.match(client, /RekindleCloud\.request\(API_PATH \+ action/);
    assert.match(client, /setInterval\([^]*10000\)/);
    assert.match(html, /js\/kindledigest\.js\?v=3/);
    assert.doesNotMatch(client, /collection-detail"\), job\.message/);
    assert.doesNotMatch(client, /if \(job\.error\) return job\.error/);
});

test("Kindle Digest backend and worker routes are private and released", function () {
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var backend = read("yandex/rekindle-backend/index.js");
    var service = read("yandex/rekindle-backend/kindle-digest-service.js");
    var rules = read("firestore.rules");
    var catalog = read("icons.js");
    var manifest = read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/);
    var sw = read("sw.js");

    assert.match(gateway, /\/api\/rekindle\/kindle-digest\/\{action\}/);
    assert.match(gateway, /\/api\/rekindle\/kindle-digest-worker\/\{action\}/);
    assert.match(backend, /requireFirebaseUser[\s\S]*?kindleDigestService\.handle/);
    assert.match(service, /KINDLE_DIGEST_ALLOWED_UIDS/);
    assert.match(service, /KINDLE_DIGEST_WORKER_SECRET/);
    assert.match(service, /timingSafeEqual/);
    assert.match(rules, /match \/kindle_digest_jobs\/\{jobId\}[\s\S]*?allow read, write: if false/);
    assert.match(rules, /match \/kindle_digest_config\/\{docId\}[\s\S]*?allow read, write: if false/);
    assert.match(catalog, /id:\s*['"]kindledigest['"]/);
    assert.ok(manifest.includes("kindledigest.html"));
    assert.ok(manifest.includes("js/kindledigest.js"));
    assert.ok(manifest.includes("locales/kindledigest-en.json"));
    assert.ok(manifest.includes("locales/kindledigest-ru.json"));
    assert.match(sw, /rekindle-cache-v51/);
    assert.match(read("index.html"), /icons\.js\?v=13/);
    assert.match(read("index_old.html"), /icons\.js\?v=13/);
    assert.doesNotMatch(catalog, /id:\s*['"]kindlearticles['"]/);
    ["kindlearticles.html", "js/kindlearticles.js", "locales/kindlearticles-en.json", "locales/kindlearticles-ru.json"].forEach(function (file) {
        assert.ok(!fs.existsSync(path.join(root, file)), file);
        assert.ok(!manifest.includes(file), file);
    });
});

test("Kindle Digest ships English and Russian UI contracts", function () {
    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/kindledigest-" + language + ".json"));
        [
            "kindledigest.title", "kindledigest.mode_daily", "kindledigest.mode_all",
            "kindledigest.collection", "kindledigest.delivery", "kindledigest.cancel",
            "kindledigest.retry", "kindledigest.error_connection", "kindledigest.failed_detail",
            "kindledigest.bytes", "kindledigest.kilobytes", "kindledigest.megabytes"
        ].forEach(function (key) { assert.ok(locale[key], language + ": " + key); });
    });
    assert.equal(JSON.parse(read("locales/kindledigest-ru.json"))["kindledigest.close"], "ОК");
});
