"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("supporter and billing surfaces stay retired", function () {
    assert.equal(fs.existsSync(path.join(root, "pay.html")), false);
    assert.equal(fs.existsSync(path.join(root, "admin/grant_pro.js")), false);
    ["index.html", "index_old.html", "settings.html", "firestore.rules",
        "yandex/rekindle-api-gateway.yaml", "yandex/rekindle-backend/index.js"].forEach(function (file) {
        assert.doesNotMatch(read(file), /ReKindle\+|supporter|billing\/|stripeCustomerId|proExpiresAt|\bisPro\b|rekindle_is_pro|plus-label|title-plus/i, file);
    });
    assert.match(read("yandex/FRONTEND-DELETE-MANIFEST.txt"), /^pay$/m);
    assert.match(read("yandex/FRONTEND-DELETE-MANIFEST.txt"), /^pay\.html$/m);
});

test("supporter locale contracts stay retired", function () {
    ["de", "en", "es", "fr", "it", "pl", "pt", "ru", "vi", "zh"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        Object.keys(locale).forEach(function (key) {
            assert.equal(key.indexOf("pay."), -1, language + ": " + key);
        });
        assert.doesNotMatch(read("locales/privacy-" + language + ".json"), /ReKindle\+|Stripe:|Ko-fi:|user storage, billing/i, language);
    });
});
