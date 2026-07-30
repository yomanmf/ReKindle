"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("screenshot apps live in Misc while requested exceptions stay outside", function () {
    var apps = vm.runInNewContext(read("icons.js") + "\nAPPS;", {
        localStorage: { getItem: function () { return null; } }
    });
    var betaApps = vm.runInNewContext(read("icons-beta.js") + "\nAPPS_BETA;");
    apps = Array.from(apps).concat(Array.from(betaApps));
    var expected = [
        "airtype", "breathing", "browser", "calculator", "calendar", "countdown",
        "dictionary", "docs", "files", "flashcards", "flipbook", "interactive",
        "maps", "microsofttodo", "notes", "photoframe", "quicktodo", "readlater",
        "reader", "readwise", "tasks", "timer", "translate", "weather",
        "wikipedia"
    ];
    var actual = apps.filter(function (app) { return app.cat === "misc"; })
        .map(function (app) { return app.id; }).sort();

    assert.equal(actual.join(","), expected.sort().join(","));
    assert.equal(apps.filter(function (app) { return app.id === "readwise"; }).length, 1);
    ["chat", "kindledigest", "reddit"].forEach(function (id) {
        assert.notEqual(apps.find(function (app) { return app.id === id; }).cat, "misc");
    });
});

test("both dashboards nest two-player games inside Games and leave Games outside Misc", function () {
    ["index.html", "index_old.html"].forEach(function (file) {
        var source = read(file);
        assert.match(source, /const miscApps = baseList\.filter\(a => a\.cat === 'misc'\)/);
        assert.match(source, /id: 'folder_misc',[\s\S]*?name: 'Разное'/);
        assert.match(source, /fragment\.appendChild\(createAppElement\(\{\s*id: 'folder_games'/);
        assert.match(source, /singlePlayerGames\.push\(\{\s*id: 'folder_two_player'/);
        assert.doesNotMatch(source, /fragment\.appendChild\(createAppElement\(\{\s*id: 'folder_two_player'/);
        assert.match(source, /id: 'folder_misc'[\s\S]*?i18nKey: 'home\.nav\.misc'/);
        assert.ok(source.indexOf("id: 'folder_two_player'") < source.indexOf("id: 'folder_games'"));
        assert.ok(source.indexOf("id: 'folder_games'") < source.indexOf("id: 'folder_misc'"));
        assert.match(source, /icons\.js\?v=9/);
        assert.match(source, /icons-beta\.js\?v=4/);
    });
});

test("Misc is localized and the updated catalog bypasses old service-worker caches", function () {
    var expected = {
        de: "Verschiedenes", en: "Misc", es: "Varios", fr: "Divers", it: "Varie",
        pl: "Różne", pt: "Diversos", ru: "Разное", vi: "Khác", zh: "其他"
    };
    Object.keys(expected).forEach(function (language) {
        assert.equal(JSON.parse(read("locales/" + language + ".json"))["home.nav.misc"], expected[language]);
    });
    assert.match(read("sw.js"), /rekindle-cache-v38/);
    assert.match(read("sw.js"), /icons\.js\?v=9/);
    assert.match(read("sw.js"), /icons-beta\.js\?v=4/);
    assert.match(read("yandex/FRONTEND-RELEASE-MANIFEST.txt"), /^icons-beta\.js$/m);
});
