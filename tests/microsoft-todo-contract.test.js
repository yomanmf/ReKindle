"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
var service = require("../yandex/rekindle-backend/microsoft-todo-service.js");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function manifestEntries() {
    return read("yandex/FRONTEND-RELEASE-MANIFEST.txt").split(/\r?\n/).map(function (line) {
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
    assert.ok(count > 0, relativePath + " should contain an inline configuration script");
}

function memoryFirestore() {
    var state = null;
    var doc = {
        get: async function () {
            return {
                exists: state !== null,
                data: function () { return state === null ? undefined : JSON.parse(JSON.stringify(state)); }
            };
        },
        set: async function (value, options) {
            if (options && options.merge && state) state = Object.assign({}, state, value);
            else state = Object.assign({}, value);
        },
        delete: async function () { state = null; },
        state: function () { return state; },
        replace: function (value) { state = value; }
    };
    return {
        collection: function () {
            return { doc: function () { return doc; } };
        },
        doc: doc
    };
}

test("Microsoft To Do page follows the Kindle browser contract", function () {
    var source = read("microsofttodo.html");
    var client = read("js/microsoft-todo.js");

    assertInlineScriptsParse("microsofttodo.html");
    assert.doesNotThrow(function () { new Function(client); });
    assert.doesNotMatch(client, /\?\.|\?\?/);
    assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
    assert.doesNotMatch(source, /display\s*:\s*flex[^}]*\bgap\s*:/i);
    assert.match(source, /transition:\s*none\s*!important/);
    assert.match(source, /animation:\s*none\s*!important/);
    assert.match(source, /font-family:\s*"Geneva",\s*"Verdana",\s*sans-serif/);
    assert.match(source, /min-height:\s*48px/);
    assert.match(source, /class="title-stripes"/);
    assert.match(source, /class="close-box"/);
    assert.match(source, /id="device-code"/);
    assert.match(source, /id="task-modal"/);
    assert.match(source, /id="logout-modal"/);
    assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(client, /[\u{1F300}-\u{1FAFF}]/u);
});

test("Microsoft To Do uses authenticated server-side Graph access", function () {
    var source = read("microsofttodo.html");
    var client = read("js/microsoft-todo.js");
    var backend = read("yandex/rekindle-backend/microsoft-todo-service.js");
    var router = read("yandex/rekindle-backend/index.js");
    var gateway = read("yandex/rekindle-api-gateway.yaml");
    var rules = read("firestore.rules");

    assert.match(source, /firebase-auth-compat\.js/);
    assert.match(source, /js\/rekindle-cloud\.js/);
    assert.match(client, /RekindleCloud\.request\("\/microsoft-todo\/"\s*\+\s*action/);
    assert.match(client, /demo=1/);
    assert.doesNotMatch(client, /localStorage\.setItem|sessionStorage\.setItem/);
    assert.match(router, /handleMicrosoftTodoRequest/);
    assert.match(gateway, /\/api\/rekindle\/microsoft-todo\/\{action\}/);
    ["status", "start", "poll", "lists", "create-list", "tasks", "create", "update", "delete", "logout"].forEach(function (action) {
        assert.match(gateway, new RegExp("\\b" + action.replace("-", "\\-") + "\\b"));
    });
    assert.match(backend, /offline_access Tasks\.ReadWrite/);
    assert.match(backend, /urn:ietf:params:oauth:grant-type:device_code/);
    assert.match(backend, /MICROSOFT_TODO_CLIENT_ID/);
    assert.match(backend, /MICROSOFT_TODO_SESSION_ENCRYPTION_KEY/);
    assert.match(backend, /aes-256-gcm/);
    assert.match(backend, /GRAPH_BASE\s*=\s*"https:\/\/graph\.microsoft\.com\/v1\.0"/);
    assert.match(backend, /GRAPH_BASE\s*\+\s*"\/me\/todo\/lists/);
    assert.doesNotMatch(source + client + backend, /client_secret/i);
    assert.match(rules, /match \/microsoft_todo_sessions\/\{userId\}[\s\S]*?allow read, write: if false/);
});

test("Microsoft To Do session encryption is UID-bound", function () {
    var key = Buffer.alloc(32, 7);
    var encrypted = service.testHooks.encryptObject(
        { refreshToken: "refresh-test", accessToken: "access-test" },
        key,
        service.testHooks.sessionAad("user-a")
    );
    assert.deepEqual(
        service.testHooks.decryptObject(encrypted, key, service.testHooks.sessionAad("user-a")),
        { refreshToken: "refresh-test", accessToken: "access-test" }
    );
    assert.throws(function () {
        service.testHooks.decryptObject(encrypted, key, service.testHooks.sessionAad("user-b"));
    });
});

test("Microsoft device authorization stores only encrypted pending and token state", async function () {
    var originalFetch = global.fetch;
    var firestore = memoryFirestore();
    var encryptionKey = Buffer.alloc(32, 9);
    var env = {
        MICROSOFT_TODO_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
        MICROSOFT_TODO_SESSION_ENCRYPTION_KEY: encryptionKey.toString("base64")
    };
    var calls = [];
    global.fetch = async function (url, options) {
        calls.push({ url: String(url), body: String(options.body || "") });
        if (String(url).indexOf("/devicecode") !== -1) {
            return new Response(JSON.stringify({
                device_code: "device-secret",
                user_code: "ABCD-EFGH",
                verification_uri: "https://microsoft.com/devicelogin",
                expires_in: 900,
                interval: 5
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            expires_in: 3600,
            scope: "Tasks.ReadWrite"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
        var started = await service.handle({ action: "start", uid: "user-a", firestore: firestore, env: env });
        assert.equal(started.stage, "code");
        assert.equal(started.userCode, "ABCD-EFGH");
        assert.match(calls[0].body, /scope=offline_access\+Tasks\.ReadWrite/);
        assert.doesNotMatch(calls[0].body, /client_secret/i);
        assert.doesNotMatch(JSON.stringify(firestore.doc.state()), /device-secret/);

        var stored = firestore.doc.state();
        var pending = service.testHooks.decryptObject(stored.pending, encryptionKey, service.testHooks.pendingAad("user-a"));
        pending.nextPollAt = 0;
        stored.pending = service.testHooks.encryptObject(pending, encryptionKey, service.testHooks.pendingAad("user-a"));
        firestore.doc.replace(stored);

        var completed = await service.handle({ action: "poll", uid: "user-a", firestore: firestore, env: env });
        assert.equal(completed.authorized, true);
        assert.equal(calls.length, 2);
        assert.doesNotMatch(JSON.stringify(firestore.doc.state()), /access-secret|refresh-secret/);
        var session = service.testHooks.decryptObject(
            firestore.doc.state().session,
            encryptionKey,
            service.testHooks.sessionAad("user-a")
        );
        assert.equal(session.accessToken, "access-secret");
        assert.equal(session.refreshToken, "refresh-secret");
    } finally {
        global.fetch = originalFetch;
    }
});

test("Microsoft Graph paths and task dates are narrowly validated", function () {
    assert.doesNotThrow(function () {
        service.testHooks.validateGraphUrl("https://graph.microsoft.com/v1.0/me/todo/lists?$top=10");
    });
    assert.throws(function () {
        service.testHooks.validateGraphUrl("https://attacker.example/v1.0/me/todo/lists");
    });
    assert.throws(function () {
        service.testHooks.validateGraphUrl("https://graph.microsoft.com/v1.0/users/admin/todo/lists");
    });
    assert.equal(service.testHooks.validateOptionalDate("2026-07-17"), "2026-07-17");
    assert.throws(function () { service.testHooks.validateOptionalDate("2026-02-30"); });
});

test("Microsoft To Do is present in catalog, release, locales, and privacy", function () {
    var catalog = read("icons.js");
    assert.match(catalog, /id:\s*['"]microsofttodo['"]/);
    assert.match(catalog, /cat:\s*['"]tools['"]/);
    assert.doesNotMatch(catalog.match(/\{\s*id:\s*['"]microsofttodo['"][\s\S]*?\n\s*\}/)[0], /plus:\s*true/);
    assert.ok(manifestEntries().includes("microsofttodo.html"));
    assert.ok(manifestEntries().includes("js/microsoft-todo.js"));

    ["de", "en", "es", "fr", "it", "pl", "pt", "ru", "vi", "zh"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        assert.ok(locale["app.microsofttodo.name"], language + " app name");
        assert.ok(locale["app.microsofttodo.desc"], language + " app description");
        var privacy = JSON.parse(read("locales/privacy-" + language + ".json"));
        assert.match(privacy["privacy.intro"], /Microsoft (?:Graph|To Do)/i, language + " privacy disclosure");
    });

    ["en", "ru"].forEach(function (language) {
        var locale = JSON.parse(read("locales/" + language + ".json"));
        [
            "microsofttodo.setup.title",
            "microsofttodo.auth.connect_title",
            "microsofttodo.auth.code_title",
            "microsofttodo.details.title",
            "microsofttodo.error.configuration",
            "microsofttodo.status.connected"
        ].forEach(function (key) {
            assert.ok(locale[key], language + ": " + key);
        });
    });
});
