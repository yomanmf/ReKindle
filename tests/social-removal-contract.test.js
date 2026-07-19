"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
var retiredAppIds = [
    "contacts", "mail", "newspaper", "stocks", "scores", "clocks", "converter", "decide",
    "dropbox", "mindmap", "pixel", "teleprompter", "journal", "bluesky", "language",
    "mastodon", "libby", "epub", "standardebooks", "cookbook", "streak", "life", "history",
    "bible", "books", "watchlist", "pinterest", "rssreader", "substack", "napkin",
    "sheetmusic", "chords", "suggestions", "discord", "food"
];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function manifestEntries(relativePath) {
    return read(relativePath).split(/\r?\n/).map(function (line) {
        return line.trim();
    }).filter(function (line) {
        return line && line.charAt(0) !== "#";
    });
}

function assertInlineScriptsParse(relativePath) {
    var source = read(relativePath);
    var scriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    var count = 0;
    while ((match = scriptPattern.exec(source)) !== null) {
        count += 1;
        assert.doesNotThrow(function () { new Function(match[1]); }, relativePath);
        assert.doesNotMatch(match[1], /\?\.|\?\?/, relativePath + " must remain ES2019-compatible");
    }
    assert.ok(count > 0, relativePath + " should contain an inline application script");
}

test("retired internal-social files and Firebase configuration are absent", function () {
    [
        "kindlechat.html",
        "neighbourhood.html",
        "topics.html",
        "moderation.html",
        "firebase-social.json",
        "firestore-social.rules",
        "rtdb-social-rules.json",
        "js/age-verification.js"
    ].forEach(function (relativePath) {
        assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
    });
});

test("Flipbook remains a primary-project standalone editor", function () {
    var flipbook = read("flipbook.html");

    assert.match(flipbook, /collection\(['"]flipnote_animations['"]\)/);
    assert.match(flipbook, /Local-only mode when the Firebase CDN is unavailable/);
    assert.doesNotMatch(flipbook, /onclick=['"]downloadGIF\(\)['"][^>]*\bdisabled\b/);
    assert.doesNotMatch(flipbook, /rekindle-socials|getSocialToken|socialAuth|firebase-database|firebase-functions|\/social\//i);

    assertInlineScriptsParse("flipbook.html");
});

test("runtime configuration exposes no internal-social backend", function () {
    var backend = read("yandex/rekindle-backend/index.js");
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var functions = read("firebase-functions/index.js");
    var primaryRules = read("rtdb-rules.json") + "\n" + read("firestore.rules");

    [backend, gateway, functions, primaryRules].forEach(function (source) {
        assert.doesNotMatch(source, /rekindle-socials|getSocialToken|socialFirebase|\/social\/|kindlechat|user_cards|users_public|age_verification_sessions/i);
    });
});

test("catalog, source pages and locale bundles omit retired applications", function () {
    var catalog = read("icons.js");
    assert.doesNotMatch(catalog, /\b(?:kindlechat|neighbourhood|topics)\b/i);
    retiredAppIds.forEach(function (id) {
        assert.doesNotMatch(catalog, new RegExp("id:\\s*['\"]" + id + "['\"]"), id);
        if (id !== "discord") assert.equal(fs.existsSync(path.join(root, id + ".html")), false, id);
    });
    assert.equal(fs.existsSync(path.join(root, "discord.svg")), false);
    assert.equal(fs.existsSync(path.join(root, "js/reports.js")), false);

    ["index.html", "index_old.html"].forEach(assertInlineScriptsParse);

    fs.readdirSync(path.join(root, "locales")).filter(function (name) {
        return /^(?:de|en|es|fr|it|pl|pt|ru|vi|zh)\.json$/.test(name);
    }).forEach(function (name) {
        var locale = JSON.parse(read(path.join("locales", name)));
        assert.equal(typeof locale["dashboard.weather.hourly"], "string", name);
        assert.equal(typeof locale["dashboard.weather.now"], "string", name);
        assert.equal(typeof locale["dashboard.weather.week"], "string", name);
        assert.equal(Object.prototype.hasOwnProperty.call(locale, "home.header.all"), false, name);
        Object.keys(locale).forEach(function (key) {
            assert.doesNotMatch(key, /^(?:app\.)?(?:kindlechat|neighbourhood|topics)\./i, name + ": " + key);
            retiredAppIds.forEach(function (id) {
                assert.doesNotMatch(key, new RegExp("^app\\." + id + "\\."), name + ": " + key);
            });
        });
    });
});

test("dashboard exposes separate single-player and two-player folders", function () {
    ["index.html", "index_old.html"].forEach(function (name) {
        var source = read(name);
        assert.match(source, /id:\s*['"]folder_games['"]/);
        assert.match(source, /id:\s*['"]folder_two_player['"]/);
        assert.match(source, /virtualFolder:\s*true/);
        assert.match(source, /i18nKey:\s*['"]home\.nav\.games['"]/);
        assert.match(source, /i18nKey:\s*['"]home\.nav\.two_player['"]/);
        assert.doesNotMatch(source, />All Games</);
        assert.match(source, /app\.cat !== ['"]games['"] && app\.cat !== ['"]two_player['"] && app\.cat !== ['"]live_game['"]/);
        assert.match(source, /#folder-modal \.modal-box\s*\{[^}]*height:\s*82vh;[^}]*overflow:\s*hidden;/s);
        assert.match(source, /#folder-options\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
        assert.match(source, /class="modal-close" onclick="closeModal\('folder-modal'\)"/);
        assert.match(source, /class="folder-actions"/);
        assert.doesNotMatch(source, /openDiscordModal/);
        assert.match(source, /window\.closeModal\s*=\s*closeModal/);
        assert.doesNotMatch(source, /id="nav-(?:dashboard|essentials|tools|lifestyle|games|two_player)"/);
        assert.doesNotMatch(source, /id="category-title"/);
        assert.match(source, /id="edit-done-btn"/);
        assert.match(source, /id="home-widgets"/);
        assert.match(source, /id="db-weather-hourly"/);
        assert.match(source, /id="db-weather-week"/);
        assert.match(source, /hourly=temperature_2m,weathercode/);
        assert.match(source, /forecast_days=7/);
        assert.match(source, /id="db-calendar-grid"/);
    });
});

test("release publishes the remaining editor and deletes retired page objects", function () {
    var release = manifestEntries("yandex/FRONTEND-RELEASE-MANIFEST.txt");
    var deleted = manifestEntries("yandex/FRONTEND-DELETE-MANIFEST.txt");

    assert.ok(release.includes("flipbook.html"));
    assert.ok(release.includes("sw.js"));
    ["kindlechat", "neighbourhood", "topics", "moderation"].forEach(function (name) {
        assert.ok(deleted.includes(name));
        assert.ok(deleted.includes(name + ".html"));
        assert.equal(release.includes(name + ".html"), false);
    });
    retiredAppIds.filter(function (id) { return id !== "discord"; }).forEach(function (id) {
        assert.ok(deleted.includes(id), id);
        assert.ok(deleted.includes(id + ".html"), id + ".html");
        assert.equal(release.includes(id + ".html"), false, id);
    });
    assert.ok(deleted.includes("discord.svg"));
    assert.ok(deleted.includes("js/reports.js"));
});
