"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

test("dashboard customization controls and state stay removed", function () {
    ["index.html", "index_old.html"].forEach(function (file) {
        var source = fs.readFileSync(path.join(root, file), "utf8");
        assert.doesNotMatch(source, /edit-done-btn|edit-toolbar|toggleEditMode|favoriteApps|hiddenApps|featuredHidden|rekindle_favorites|rekindle_featured_hidden/);
        assert.match(source, /<div class="grid-container" id="app-grid"><\/div>/);
    });
});

test("dashboard customization translations stay removed", function () {
    ["de", "en", "es", "fr", "it", "pl", "pt", "ru", "vi", "zh"].forEach(function (language) {
        var locale = JSON.parse(fs.readFileSync(path.join(root, "locales", language + ".json"), "utf8"));
        ["home.btn.done", "home.btn.edit", "home.btn.featured_off", "home.btn.featured_on", "home.btn.reset", "home.header.favorites"].forEach(function (key) {
            assert.equal(locale[key], undefined, language + ": " + key);
        });
    });
});
