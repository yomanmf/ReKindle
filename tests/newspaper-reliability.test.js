"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var root = path.resolve(__dirname, "..");
var cloudSource = fs.readFileSync(path.join(root, "js/rekindle-cloud.js"), "utf8");
var newspaperSource = fs.readFileSync(path.join(root, "newspaper.html"), "utf8");

function loadCloud(firebase, fetchImpl) {
    var context = {
        window: {},
        firebase: firebase,
        fetch: fetchImpl,
        Promise: Promise,
        Error: Error,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
    };
    vm.runInNewContext(cloudSource, context, { filename: "js/rekindle-cloud.js" });
    return context.window.RekindleCloud;
}

function jsonResponse(value) {
    return {
        ok: true,
        status: 200,
        json: async function () { return value; }
    };
}

test("protected requests wait for Firebase to restore the signed-in user", async function () {
    var authCallback = null;
    var fetchCalls = [];
    var user = {
        getIdToken: async function () { return "restored-token"; }
    };
    var auth = {
        currentUser: null,
        onAuthStateChanged: function (callback) {
            authCallback = callback;
            return function () {};
        }
    };
    var cloud = loadCloud({ auth: function () { return auth; } }, async function (url, options) {
        fetchCalls.push({ url: url, options: options });
        return jsonResponse({ title: "Loaded" });
    });

    var request = cloud.request("/content/reader?url=article");
    assert.equal(fetchCalls.length, 0);
    assert.equal(typeof authCallback, "function");

    auth.currentUser = user;
    authCallback(user);
    var result = await request;

    assert.equal(result.title, "Loaded");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].options.headers["X-Firebase-Token"], "restored-token");
});

test("protected requests still reject a user who is signed out after auth readiness", async function () {
    var authCallback = null;
    var fetchCalls = 0;
    var auth = {
        currentUser: null,
        onAuthStateChanged: function (callback) {
            authCallback = callback;
            return function () {};
        }
    };
    var cloud = loadCloud({ auth: function () { return auth; } }, async function () {
        fetchCalls += 1;
        return jsonResponse({});
    });

    var request = cloud.request("/content/reader?url=article");
    authCallback(null);

    await assert.rejects(request, /Please sign in first\./);
    assert.equal(fetchCalls, 0);
});

test("newspaper sends remote thumbnails through the bounded Yandex proxy", function () {
    assert.match(newspaperSource, /RekindleCloud\.apiBase\s*\+\s*['"]\/content\/proxy\?url=/);
    assert.match(newspaperSource, /image\.src\s*=\s*proxiedImageUrl/);
    assert.match(newspaperSource, /image\.onload\s*=\s*function/);
    assert.match(newspaperSource, /image\.onerror\s*=\s*function/);
    assert.doesNotMatch(newspaperSource, /<img\s+src=["']\$\{imgUrl\}/);
});

test("newspaper inline scripts remain ES2019-compatible", function () {
    var scriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    var count = 0;
    while ((match = scriptPattern.exec(newspaperSource)) !== null) {
        count += 1;
        assert.doesNotThrow(function () { new Function(match[1]); });
        assert.doesNotMatch(match[1], /\?\.|\?\?/);
    }
    assert.ok(count > 0);
});
