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
        assert.match(source, /function requireLogin\(\) \{[\s\S]*?openLogin\(\);/);
        assert.doesNotMatch(source, /home\.guest_mode|Guest Mode|handleGuestMode/);
        assert.match(source, /id="sys-account-menu" hidden/);
        assert.match(source, /requireLogin\(\)[\s\S]*?getElementById\('sys-account-menu'\)\.hidden = true;/);
        assert.doesNotMatch(source, /id="auth-btn"[^>]*(?:onclick="openLogin\(\)"|data-i18n="home\.nav\.login")/);
        assert.match(source, /modalId === 'login-modal' && \(!auth \|\| !auth\.currentUser\)/);
    });
    assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), /rekindle-cache-v53/);
});

test("signed-in dashboard puts the username in the rightmost account menu", function () {
    ["index.html", "index_old.html"].forEach(function (file) {
        var source = fs.readFileSync(path.join(root, file), "utf8");
        assert.match(source, /id="auth-btn"[\s\S]*?id="account-menu-dropdown" hidden[\s\S]*?>Log Out<\/button>/);
        assert.match(source, /getElementById\('sys-account-menu'\)\.hidden = false;[\s\S]*?getElementById\('auth-btn'\)\.innerText = displayUser;[\s\S]*?onclick = toggleAccountMenu;/);
    });
});
