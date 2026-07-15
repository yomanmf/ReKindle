"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var manifestPath = path.join(__dirname, "FRONTEND-RELEASE-MANIFEST.txt");
var outputDir = process.env.REKINDLE_YANDEX_RELEASE_DIR || "/private/tmp/rekindle-yandex-release";
var stageDir = path.join(outputDir, "rekindle-frontend-stage");
var archivePath = path.join(outputDir, "rekindle-frontend.zip");
var firebaseApiKeyPlaceholder = "__REKINDLE_FIREBASE_API_KEY__";
var firebaseApiKey = process.env.REKINDLE_FIREBASE_API_KEY;
var socialFiles = {
    "flipbook.html": true,
    "kindlechat.html": true,
    "neighbourhood.html": true,
    "pixel.html": true,
    "topics.html": true
};

var files = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).map(function (line) {
    return line.trim();
}).filter(function (line) {
    return line && line.charAt(0) !== "#";
});

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
var archiveObjectPaths = [];
var firebaseConfigFiles = 0;
var firebaseConfigReplacements = 0;

function prepareReleaseSource(relativePath, source) {
    var content = fs.readFileSync(source);
    if (content.indexOf(firebaseApiKeyPlaceholder) === -1) return content;
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(firebaseApiKey || "")) {
        throw new Error("REKINDLE_FIREBASE_API_KEY is required to prepare " + relativePath + ".");
    }

    var text = content.toString("utf8");
    var replacementCount = text.split(firebaseApiKeyPlaceholder).length - 1;
    var prepared = text.split(firebaseApiKeyPlaceholder).join(firebaseApiKey);
    if (prepared.indexOf(firebaseApiKeyPlaceholder) !== -1) {
        throw new Error("Firebase API key placeholder remains in " + relativePath + ".");
    }
    firebaseConfigFiles++;
    firebaseConfigReplacements += replacementCount;
    return Buffer.from(prepared, "utf8");
}

files.forEach(function (relativePath) {
    if (socialFiles[relativePath]) throw new Error("Social file is not allowed in this release: " + relativePath);
    var source = path.join(root, relativePath);
    if (!fs.statSync(source).isFile()) throw new Error("Release source is not a file: " + relativePath);
    var destination = path.join(stageDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, prepareReleaseSource(relativePath, source));
    var sourceStat = fs.statSync(source);
    fs.utimesSync(destination, sourceStat.atime, sourceStat.mtime);
    archiveObjectPaths.push(relativePath);

    if (/^[^/]+\.html$/.test(relativePath)) {
        var aliasRelativePath = relativePath.slice(0, -5);
        var aliasPath = path.join(stageDir, aliasRelativePath);
        fs.copyFileSync(destination, aliasPath);
        fs.utimesSync(aliasPath, sourceStat.atime, sourceStat.mtime);
        archiveObjectPaths.push(aliasRelativePath);
    }
});

fs.rmSync(archivePath, { force: true });
childProcess.execFileSync("zip", ["-q", "-X", archivePath].concat(archiveObjectPaths), { cwd: stageDir });

var archiveEntries = childProcess.execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
    .trim().split(/\r?\n/).filter(Boolean);
var archiveObjects = archiveEntries.filter(function (relativePath) {
    return relativePath.charAt(relativePath.length - 1) !== "/";
});
var expectedAliases = files.filter(function (relativePath) {
    return /^[^/]+\.html$/.test(relativePath);
}).length;
var expectedEntries = files.length + expectedAliases;
if (archiveObjects.length !== expectedEntries) {
    throw new Error("Frontend archive contains " + archiveObjects.length + " objects; expected " + expectedEntries + ".");
}
archiveObjects.forEach(function (relativePath) {
    if (socialFiles[relativePath] || socialFiles[relativePath + ".html"]) {
        throw new Error("Social object leaked into frontend archive: " + relativePath);
    }
    var stagedObject = fs.readFileSync(path.join(stageDir, relativePath));
    if (stagedObject.indexOf(firebaseApiKeyPlaceholder) !== -1) {
        throw new Error("Firebase API key placeholder leaked into release object: " + relativePath);
    }
});

console.log(JSON.stringify({
    archive: archivePath,
    sourceFiles: files.length,
    extensionlessAliases: expectedAliases,
    objects: archiveObjects.length,
    firebaseConfigFiles: firebaseConfigFiles,
    firebaseConfigReplacements: firebaseConfigReplacements
}, null, 2));
