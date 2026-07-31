"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Exchange Calendar uses authenticated server-side EWS access", function () {
    var calendar = read("calendar.html");
    var dashboard = read("index.html");
    var backend = read("yandex/rekindle-backend/exchange-calendar-service.js");
    var router = read("yandex/rekindle-backend/index.js");
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var rules = read("firestore.rules");

    assert.match(backend, /https:\/\/mailsec\.o3t\.ru\/EWS\/Exchange\.asmx/);
    assert.match(backend, /CalendarView/);
    assert.match(backend, /aes-256-gcm/);
    assert.doesNotMatch(calendar + dashboard, /mailsec\.o3t\.ru|Authorization\s*:/);
    assert.match(calendar, /RekindleCloud\.request\(['"]\/exchange-calendar\//);
    assert.match(calendar, /let currentUser = null/);
    assert.match(dashboard, /RekindleCloud\.request\(['"]\/exchange-calendar\/events/);
    assert.match(router, /handleExchangeCalendarRequest/);
    assert.match(gateway, /\/api\/rekindle\/exchange-calendar\/\{action\}/);
    assert.match(rules, /match \/exchange_calendar_sessions\/\{userId\}[\s\S]*?allow read, write: if false/);
});

test("Exchange Calendar client remains compatible with Chromium 75", function () {
    var source = read("calendar.html") + read("index.html");
    assert.doesNotMatch(source, /\?\.|\?\?/);
    assert.doesNotMatch(source, /alert\s*\(|confirm\s*\(|prompt\s*\(/);
});
