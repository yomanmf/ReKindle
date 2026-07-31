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

test("event details close only when the backdrop is tapped", function () {
    var calendar = read("calendar.html");
    assert.match(calendar, /id="event-detail-modal" onclick="if \(event\.target === this\) closeEventDetails\(\)"/);
});

test("dashboard shows every meeting above the calendar in 24-hour time", function () {
    var dashboard = read("index.html");
    var agendaPosition = dashboard.indexOf('id="db-agenda-list"');
    var calendarPosition = dashboard.indexOf('id="db-calendar-grid"');
    var weatherPosition = dashboard.indexOf('dashboard-weather-widget');

    assert.ok(agendaPosition > -1 && agendaPosition < calendarPosition);
    assert.ok(calendarPosition < weatherPosition);
    assert.doesNotMatch(dashboard, /\.dashboard-agenda-list\s*\{[^}]*max-height/);
    assert.doesNotMatch(dashboard, /\.dashboard-agenda-list\s*\{[^}]*overflow-y/);
    assert.match(dashboard, /timeStr = formatDashboardEventTime\(e\.start\)/);
    assert.match(dashboard, /id="db-agenda-refresh"[^>]*onclick="refreshDashboardAgenda\(this\)"/);
    assert.match(dashboard, /\.dashboard-agenda-refresh\s*\{[^}]*min-height:\s*40px/);
    assert.match(dashboard, /window\.refreshDashboardAgenda = refreshDashboardAgenda/);
});

test("both dashboard calendars start the week on Monday", function () {
    [read("index.html"), read("index_old.html")].forEach(function (dashboard) {
        assert.match(dashboard, /getDay\(\) \+ 6\) % 7/);
        assert.match(dashboard, /new Date\(2024, 0, 8 \+ weekday\)/);
        assert.doesNotMatch(dashboard, /new Date\(2024, 0, 7 \+ weekday\)/);
    });
});
