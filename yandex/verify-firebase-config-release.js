"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var SITE_BASE = "https://rekindle.website.yandexcloud.net";
var PROJECT_ROOT = path.resolve(__dirname, "..");
var RELEASE_DIR = process.env.REKINDLE_CONFIG_RELEASE_DIR || "/private/tmp/rekindle-firebase-config-release";
var MANIFEST = JSON.parse(fs.readFileSync(path.join(RELEASE_DIR, "manifest.json"), "utf8"));
var CONCURRENCY = 10;
var OLD_CONFIG = /rekindle-dd1fa|748026882518|1:748026882518:web:6877dd4329318070c11c77/;

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

async function mapWithConcurrency(items, worker) {
    var results = new Array(items.length);
    var cursor = 0;
    async function next() {
        while (cursor < items.length) {
            var index = cursor++;
            results[index] = await worker(items[index]);
        }
    }
    var runners = [];
    for (var i = 0; i < Math.min(CONCURRENCY, items.length); i++) runners.push(next());
    await Promise.all(runners);
    return results;
}

async function fetchObject(name, allowNotFound) {
    var separator = name.indexOf("?") === -1 ? "?" : "&";
    var response = await fetch(SITE_BASE + "/" + encodeURIComponent(name) + separator + "verify=" + Date.now(), {
        headers: { "Cache-Control": "no-cache" }
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new Error(name + " returned HTTP " + response.status + ".");
    return {
        body: await response.text(),
        contentType: response.headers.get("content-type") || ""
    };
}

async function verifyManifestObject(expected) {
    var actual = await fetchObject(expected.objectName);
    if (sha256(actual.body) !== expected.sha256) throw new Error(expected.objectName + " hash mismatch.");
    if (OLD_CONFIG.test(actual.body)) throw new Error(expected.objectName + " still contains upstream Firebase config.");
    if (expected.html && actual.contentType.toLowerCase().indexOf("text/html") === -1) {
        throw new Error(expected.objectName + " has incorrect Content-Type " + actual.contentType + ".");
    }
    if (!expected.html && expected.objectName === "pro-gate.js" && !/javascript/i.test(actual.contentType)) {
        throw new Error("pro-gate.js has incorrect Content-Type " + actual.contentType + ".");
    }
}

async function auditSiteFile(name) {
    var actual = await fetchObject(name, name.indexOf(".") === -1);
    if (!actual) return false;
    if (OLD_CONFIG.test(actual.body)) throw new Error(name + " still contains upstream Firebase config.");
    if (/\.html$/.test(name) || name.indexOf(".") === -1) {
        if (actual.contentType.toLowerCase().indexOf("text/html") === -1) {
            throw new Error(name + " has incorrect Content-Type " + actual.contentType + ".");
        }
    }
    return true;
}

async function run() {
    var expectedObjects = [];
    MANIFEST.files.forEach(function (item) {
        expectedObjects.push({ objectName: item.name, sha256: item.releaseSha256, html: /\.html$/.test(item.name) });
        if (item.extensionlessAlias) {
            expectedObjects.push({ objectName: item.extensionlessAlias, sha256: item.releaseSha256, html: true });
        }
    });
    if (expectedObjects.length !== MANIFEST.objectCount) throw new Error("Manifest object count mismatch.");
    await mapWithConcurrency(expectedObjects, verifyManifestObject);
    console.log("PASS exact hashes and Content-Type for " + expectedObjects.length + " release objects");

    var htmlFiles = fs.readdirSync(PROJECT_ROOT).filter(function (name) { return /\.html$/.test(name); }).sort();
    var siteObjects = [];
    htmlFiles.forEach(function (name) {
        siteObjects.push(name);
        siteObjects.push(name.slice(0, -5));
    });
    siteObjects.push("pro-gate.js");
    var audited = await mapWithConcurrency(siteObjects, auditSiteFile);
    var existingCount = audited.filter(Boolean).length;
    var missingAliases = audited.length - existingCount;
    console.log("PASS no upstream Firebase config across " + existingCount + " existing production objects");
    if (missingAliases) console.log("INFO skipped " + missingAliases + " unrelated pre-existing 404 extensionless aliases");
}

run().catch(function (error) {
    console.error("FAIL " + error.message);
    process.exitCode = 1;
});
