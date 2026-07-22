"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

test("shared browser analytics excludes query strings and uses the Yandex collector", function () {
    var theme = fs.readFileSync(path.join(root, "theme.js"), "utf8");
    var cloud = fs.readFileSync(path.join(root, "js/rekindle-cloud.js"), "utf8");
    assert.match(theme, /api\/rekindle\/analytics\/events/);
    assert.match(theme, /requestText: 'GET ' \+ \(window\.location\.pathname \|\| '\/'\)/);
    assert.match(cloud, /split\("\?", 1\)\[0\]/);
    assert.match(cloud, /requestType: "api_request"/);
});

test("service worker and root pages use the analytics-aware theme version", function () {
    var serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    assert.match(serviceWorker, /rekindle-cache-v25/);
    assert.match(serviceWorker, /theme\.js\?v=21/);
    var pages = fs.readdirSync(root).filter(function (name) {
        return name.endsWith(".html") && fs.readFileSync(path.join(root, name), "utf8").indexOf("theme.js?v=") !== -1;
    });
    assert.ok(pages.length > 90);
    pages.forEach(function (page) {
        assert.match(fs.readFileSync(path.join(root, page), "utf8"), /theme\.js\?v=21/, page);
    });
});
