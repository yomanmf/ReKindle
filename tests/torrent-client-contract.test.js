"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("torrent controls are authenticated, destructive, and Kindle-safe", function () {
    var html = read("torrents.html");
    var client = read("js/torrents.js");
    assert.match(html, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(html, /animation:\s*none\s*!important/);
    assert.match(html, /min-height:\s*48px/);
    assert.match(html, /id="delete-modal"/);
    assert.match(client, /request\("torrent-delete",\s*\{ hash: torrent\.hash \}\)/);
    assert.match(client, /request\("media-delete",\s*\{ requestId: torrent\.requestId, mediaId: torrent\.mediaId \}\)/);
    assert.match(client, /RekindleCloud\.request\(API_PATH \+ action/);
    assert.match(html, /id="filter-completed"/);
    assert.match(client, /currentFilter === "completed" \? items\.filter\(isCompleted\) : items/);
    assert.match(client, /Number\(torrent\.progress\)[^\n]*>= 1/);
    assert.match(client, /torrents\.state_completed/);
    assert.doesNotMatch(html + client, /alert\(|confirm\(|prompt\(/);
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(html + client, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(client, /setInterval/);
});

test("torrent controls are routed, catalogued, cache-busted, and released", function () {
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var service = read("yandex/rekindle-backend/manga-kindle-service.js");
    var catalog = read("icons-beta.js");
    var manifest = read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/);
    assert.match(gateway, /enum:\s*\[[^\]]*torrents[^\]]*torrent-delete[^\]]*media-delete/);
    assert.match(service, /torrents:\s*true/);
    assert.match(service, /"torrent-delete":\s*true/);
    assert.match(service, /"media-delete":\s*true/);
    assert.match(catalog, /id:\s*['"]torrents['"]/);
    assert.match(catalog, /id:\s*['"]torrents['"][\s\S]*?name:\s*['"]Torrents['"][\s\S]*?cat:\s*['"]lifestyle['"]/);
    assert.doesNotMatch(catalog.match(/id:\s*['"]torrents['"][\s\S]*?\n\s*\}/)[0], /beta:\s*true/);
    ["torrents.html", "js/torrents.js", "locales/torrents-en.json", "locales/torrents-ru.json"].forEach(function (file) {
        assert.ok(manifest.includes(file), file);
    });
    assert.match(read("index.html"), /icons-beta\.js\?v=12/);
    assert.match(read("index_old.html"), /icons-beta\.js\?v=12/);
    assert.match(read("sw.js"), /rekindle-cache-v61/);
    assert.match(read("sw.js"), /icons-beta\.js\?v=12/);
    assert.match(read("torrents.html"), /js\/torrents\.js\?v=3/);
});
