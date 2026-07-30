"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");

test("Kindle Digest draws a Kindle-safe pictogram for every job status", function () {
    var client = fs.readFileSync("js/kindledigest.js", "utf8");
    var html = fs.readFileSync("kindledigest.html", "utf8");
    ["waiting", "collecting", "building", "complete", "sending", "sent", "failed", "canceled", "running"].forEach(function (status) {
        assert.match(client, new RegExp(status + ": '<"));
    });
    assert.match(client, /setStatusValue\(byId\("collection-state"\)/);
    assert.match(client, /setStatusValue\(byId\("delivery-state"\)/);
    assert.match(html, /\.status-icon\s*\{/);
    assert.match(html, /\.history-item\s*\{[^}]*display:\s*grid/s);
    assert.doesNotMatch(html, /\.history-state\s*\{[^}]*float\s*:/s);
    assert.match(html, /js\/kindledigest\.js\?v=2/);
    assert.match(html, /top:\s*-14px;[^}]*right:\s*-14px;[^}]*bottom:\s*-14px;[^}]*left:\s*-14px/s);
    assert.match(html, /\.status-detail[^}]*word-break:\s*break-word/);
    assert.doesNotMatch(client + html, /[\u{1F300}-\u{1FAFF}]/u);
});
