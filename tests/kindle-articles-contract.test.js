"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("Article to Kindle is a Kindle-safe direct control UI", function () {
    var html = read("kindlearticles.html");
    var client = read("js/kindlearticles.js");
    assert.match(html, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(html, /animation:\s*none\s*!important/);
    assert.match(html, /min-height:\s*48px/);
    assert.match(html, /body\s*>\s*\.window\s*\{[^}]*zoom:\s*1\s*!important/s);
    assert.match(html, /class="title-stripes"/);
    assert.match(html, /id="error-modal"/);
    assert.match(client, /STATUS_ICONS/);
    assert.match(client, /rekindle:i18n:ready/);
    assert.match(client, /mode:\s*"article"/);
    assert.match(client, /RekindleCloud\.request\(API_PATH \+ action/);
    assert.match(client, /setInterval\([^]*10000\)/);
    assert.doesNotMatch(html + client, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(html + client, /telegram/i);
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(html, /display:\s*flex[^}]*\bgap\s*:/s);
});

test("Article to Kindle reuses the private Kindle worker and is released", function () {
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var service = read("yandex/rekindle-backend/kindle-digest-service.js");
    var manifest = read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/);
    assert.match(gateway, /\/api\/rekindle\/kindle-digest\/\{action\}/);
    assert.match(gateway, /\/api\/rekindle\/kindle-digest-worker\/\{action\}/);
    assert.match(service, /mode !== "article"/);
    assert.match(service, /job\.mode === "article" \? "article" : "digest"/);
    assert.match(read("icons.js"), /id:\s*['"]kindlearticles['"]/);
    ["kindlearticles.html", "js/kindlearticles.js", "locales/kindlearticles-en.json", "locales/kindlearticles-ru.json"].forEach(function (file) {
        assert.ok(manifest.includes(file), file);
    });
});

test("Article to Kindle ships English and Russian UI contracts", function () {
    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/kindlearticles-" + language + ".json"));
        [
            "kindlearticles.title", "kindlearticles.url", "kindlearticles.submit",
            "kindlearticles.processing", "kindlearticles.delivery", "kindlearticles.cancel",
            "kindlearticles.retry", "kindlearticles.error_connection"
        ].forEach(function (key) { assert.ok(locale[key], language + ": " + key); });
    });
});
