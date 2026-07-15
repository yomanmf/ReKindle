"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var SITE_BASE = "https://rekindle.website.yandexcloud.net";
var PROJECT_ROOT = path.resolve(__dirname, "..");
var OUTPUT_DIR = process.env.REKINDLE_CONFIG_RELEASE_DIR || "/private/tmp/rekindle-firebase-config-release";
var CONCURRENCY = 8;
var FIREBASE_API_KEY_PLACEHOLDER = "__REKINDLE_FIREBASE_API_KEY__";
var CURRENT_FIREBASE_API_KEY = process.env.REKINDLE_CURRENT_FIREBASE_API_KEY;
var TARGET_FIREBASE_API_KEY = process.env.REKINDLE_FIREBASE_API_KEY;

if ((CURRENT_FIREBASE_API_KEY && !/^AIza[0-9A-Za-z_-]{30,}$/.test(CURRENT_FIREBASE_API_KEY)) ||
    !/^AIza[0-9A-Za-z_-]{30,}$/.test(TARGET_FIREBASE_API_KEY || "")) {
    throw new Error("REKINDLE_FIREBASE_API_KEY is required; REKINDLE_CURRENT_FIREBASE_API_KEY must be valid when supplied.");
}

var REPLACEMENTS = [
    [FIREBASE_API_KEY_PLACEHOLDER, TARGET_FIREBASE_API_KEY],
    ["rekindle-dd1fa.firebaseapp.com", "rekindle-fork.firebaseapp.com"],
    ["rekindle-dd1fa.firebasestorage.app", "rekindle-fork.firebasestorage.app"],
    ["1:748026882518:web:6877dd4329318070c11c77", "1:136525921771:web:1ab69288e786dbfd9e2dae"],
    ["748026882518", "136525921771"],
    ["https://rekindle-dd1fa-default-rtdb.firebaseio.com", "https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app"],
    ["rekindle-dd1fa", "rekindle-fork"]
];
if (CURRENT_FIREBASE_API_KEY && CURRENT_FIREBASE_API_KEY !== TARGET_FIREBASE_API_KEY) {
    REPLACEMENTS.unshift([CURRENT_FIREBASE_API_KEY, TARGET_FIREBASE_API_KEY]);
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function countOccurrences(value, needle) {
    if (!needle) return 0;
    return value.split(needle).length - 1;
}

function patchConfig(source) {
    var output = source;
    var counts = {};
    for (var i = 0; i < REPLACEMENTS.length; i++) {
        var from = REPLACEMENTS[i][0];
        var to = REPLACEMENTS[i][1];
        var count = countOccurrences(output, from);
        if (!count) continue;
        counts[from] = count;
        output = output.split(from).join(to);
    }
    return { output: output, counts: counts };
}

async function fetchProductionFile(name) {
    var response = await fetch(SITE_BASE + "/" + encodeURIComponent(name), {
        headers: { "Cache-Control": "no-cache" }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(name + " returned HTTP " + response.status + ".");
    return response.text();
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

async function prepareFile(name) {
    var source = await fetchProductionFile(name);
    if (source === null) return null;
    var patched = patchConfig(source);
    var replacementCount = Object.keys(patched.counts).reduce(function (sum, key) {
        return sum + patched.counts[key];
    }, 0);
    if (!replacementCount) return null;
    for (var i = 0; i < REPLACEMENTS.length; i++) {
        if (patched.output.indexOf(REPLACEMENTS[i][0]) !== -1) {
            throw new Error(name + " still contains old Firebase value " + REPLACEMENTS[i][0] + ".");
        }
    }

    var destination = path.join(OUTPUT_DIR, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, patched.output);
    if (/\.html$/.test(name)) {
        fs.writeFileSync(path.join(OUTPUT_DIR, name.slice(0, -5)), patched.output);
    }
    return {
        name: name,
        extensionlessAlias: /\.html$/.test(name) ? name.slice(0, -5) : null,
        replacements: patched.counts,
        sourceSha256: sha256(source),
        releaseSha256: sha256(patched.output),
        bytes: Buffer.byteLength(patched.output)
    };
}

async function run() {
    var files = fs.readdirSync(PROJECT_ROOT).filter(function (name) {
        return /\.html$/.test(name);
    }).sort();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    var prepared = (await mapWithConcurrency(files, prepareFile)).filter(Boolean);
    var manifest = {
        generatedAt: new Date().toISOString(),
        source: SITE_BASE,
        replacementsOnly: true,
        fileCount: prepared.length,
        objectCount: prepared.reduce(function (sum, item) {
            return sum + (item.extensionlessAlias ? 2 : 1);
        }, 0),
        files: prepared
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log("Prepared " + manifest.fileCount + " source files (" + manifest.objectCount + " objects).");
    prepared.forEach(function (item) { console.log(item.name); });
    console.log("Manifest: " + path.join(OUTPUT_DIR, "manifest.json"));
}

run().catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
});
