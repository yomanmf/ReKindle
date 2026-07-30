"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("donation prompts and checkout entry points stay retired", function () {
    ["index.html", "index_old.html", "settings.html", "pay.html", "sw.js", "sw-offline.js"].forEach(function (file) {
        assert.doesNotMatch(read(file), /donate\.svg|openDonateModal|support\.get|billing\/checkout/);
    });
    assert.match(read("pay.html"), /billing\.stripe\.com/);
    assert.doesNotMatch(read("README.md"), /rekindle\.ink\/pay|subscribe at/i);
    assert.match(read("yandex/FRONTEND-DELETE-MANIFEST.txt"), /^donate\.svg$/m);
});

test("donation locale contracts are gone while subscription management remains localized", function () {
    ["de", "en", "es", "fr", "it", "pl", "pt", "ru", "vi", "zh"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        ["home.btn.donate", "home.info.buy_coffee", "home.info.donate_title", "home.info.scan_donate",
            "support.desc", "support.get", "supporters.btn.kofi"].forEach(function (key) {
            assert.equal(locale[key], undefined, language + ": " + key);
        });
        assert.ok(locale["pay.hint.guest"]);
        assert.ok(locale["pay.status.inactive"]);
        assert.ok(locale["pay.btn.manage"]);
    });
});

test("supporter status remains cosmetic and does not gate apps", function () {
    assert.doesNotMatch(read("icons.js"), /plus\s*:\s*true/);
    ["index.html", "index_old.html"].forEach(function (file) {
        assert.match(read(file), /const showPlus = false/);
        assert.doesNotMatch(read(file), /app\.plus/);
    });
});
