"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

test("Kindle dashboards keep login visible until the server check succeeds", function () {
    ["index.html", "index_old.html"].forEach(function (file) {
        var source = fs.readFileSync(path.join(root, file), "utf8");
        assert.match(source, /loginSecurityCheckPending/);
        assert.match(source, /setPersistence\(firebase\.auth\.Auth\.Persistence\.LOCAL\)/);
        assert.match(source, /RekindleIpBan\.checkOnLogin\(\)/);
        assert.match(source, /if \(!loginSecurityCheckPending\) closeModal\('login-modal'\)/);
        assert.match(source, /signedInThisAttempt && auth\.currentUser[\s\S]*?auth\.signOut/);
    });
    assert.match(fs.readFileSync(path.join(root, "index_old.html"), "utf8"), /js\/rekindle-cloud\.js\?v=2/);
});

test("Kindle dashboards keep signed-out users behind the login wall", function () {
    ["index.html", "index_old.html"].forEach(function (file) {
        var source = fs.readFileSync(path.join(root, file), "utf8");
        assert.match(source, /id="login-modal"[^>]*aria-modal="true"/);
        assert.doesNotMatch(source, /id="login-modal"[^>]*style="display:flex"/);
        assert.doesNotMatch(source, /onclick="closeModal\('login-modal'\)"/);
        assert.match(source, /function handleGuestMode\(\) \{[\s\S]*?openLogin\(\);/);
        assert.match(source, /modalId === 'login-modal' && \(!auth \|\| !auth\.currentUser\)/);
    });
    assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), /rekindle-cache-v51/);
});
