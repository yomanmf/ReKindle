"use strict";

var fs = require("node:fs");
var admin = require("firebase-admin");

var API_BASE = "https://d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net/api/rekindle";
var ORIGIN = "https://rekindle.website.yandexcloud.net";
var WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
var SERVICE_ACCOUNT_FILE = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;

if (!WEB_API_KEY || !SERVICE_ACCOUNT_FILE) {
    throw new Error("FIREBASE_WEB_API_KEY and FIREBASE_SERVICE_ACCOUNT_FILE are required.");
}

var username = "e2e" + Date.now().toString().slice(-10);
var password = "Test" + Date.now().toString() + "A";
var uid = "";
var idToken = "";
var objectPath = "";
var app;

async function jsonRequest(url, options, expectedStatus) {
    var response = await fetch(url, options || {});
    var data = {};
    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }
    if (expectedStatus !== undefined && response.status !== expectedStatus) {
        throw new Error("Expected HTTP " + expectedStatus + " from " + url + ", received " + response.status + ".");
    }
    if (expectedStatus === undefined && !response.ok) {
        throw new Error("Request failed with HTTP " + response.status + " at " + url + ".");
    }
    return { response: response, data: data };
}

function backendHeaders(withAuth) {
    var headers = { Origin: ORIGIN, "Content-Type": "application/json" };
    if (withAuth) headers["X-Firebase-Token"] = idToken;
    return headers;
}

async function exchangeCustomToken(customToken) {
    var result = await jsonRequest(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(WEB_API_KEY),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Referer: ORIGIN + "/"
            },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        }
    );
    idToken = result.data.idToken;
    uid = result.data.localId || "";
    if (!uid && idToken) {
        var payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
        uid = payload.user_id || payload.sub || "";
    }
}

async function backend(path, method, body, expectedStatus) {
    return jsonRequest(API_BASE + path, {
        method: method,
        headers: backendHeaders(path !== "/auth/register"),
        body: body === undefined ? undefined : JSON.stringify(body)
    }, expectedStatus);
}

async function cleanup() {
    if (idToken && objectPath) {
        await backend("/storage/object", "DELETE", { path: objectPath }).catch(function () {});
    }
    if (!app) return;
    if (!uid) {
        var user = await app.auth().getUserByEmail(username + "@rekindle.ink").catch(function () { return null; });
        if (user) uid = user.uid;
    }
    if (!uid) return;
    await app.database().ref().update({
        ["users_private/" + uid]: null,
        ["api_daily_limits/" + uid]: null,
        ["api_rate_limits/" + uid]: null
    }).catch(function () {});
    await app.auth().deleteUser(uid).catch(function () {});
}

async function run() {
    var serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));
    app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app"
    }, "rekindle-production-e2e");

    try {
        var registration = await backend("/auth/register", "POST", { username: username, password: password }, 200);
        await exchangeCustomToken(registration.data.customToken);
        if (!uid || !idToken) throw new Error("Registration did not return a usable Firebase session.");
        console.log("PASS register and custom-token login");

        var ipCheck = await backend("/auth/check-ip", "POST", {}, 200);
        if (ipCheck.data.banned !== false) throw new Error("Fresh E2E account was unexpectedly IP-banned.");
        console.log("PASS server-side IP check");

        var quotaBefore = await backend("/ai/chat", "POST", { action: "quota" }, 200);
        if (!quotaBefore.data.quota || typeof quotaBefore.data.quota.remaining !== "number") {
            throw new Error("AI quota response is malformed.");
        }
        var aiReply = await backend("/ai/chat", "POST", {
            prompt: "Reply with the single word OK."
        }, 200);
        if (!aiReply.data.text || !aiReply.data.quota) {
            throw new Error("Shared AI response is malformed.");
        }
        if (aiReply.data.quota.remaining !== quotaBefore.data.quota.remaining - 1) {
            throw new Error("Shared AI quota did not decrement after a successful response.");
        }
        var quotaAfter = await backend("/ai/chat", "POST", { action: "quota" }, 200);
        if (quotaAfter.data.quota.remaining !== aiReply.data.quota.remaining) {
            throw new Error("AI quota readback does not match the successful response.");
        }
        console.log("PASS authenticated shared AI and server-authoritative quota");

        var initialList = await backend("/storage/list?folder=files", "GET", undefined, 200);
        if (!Array.isArray(initialList.data.items)) throw new Error("Storage list response is malformed.");
        console.log("PASS authenticated storage list without a Pro entitlement");

        var payload = "ReKindle production E2E";
        objectPath = "users/" + uid + "/files/e2e.txt";
        var signedUpload = await backend("/storage/upload-url", "POST", {
            path: objectPath,
            size: Buffer.byteLength(payload),
            contentType: "text/plain"
        }, 200);
        var preflight = await fetch(signedUpload.data.url, {
            method: "OPTIONS",
            headers: {
                Origin: ORIGIN,
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type"
            }
        });
        if (!preflight.ok || preflight.headers.get("access-control-allow-origin") !== ORIGIN) {
            throw new Error("Object Storage CORS preflight failed.");
        }
        var upload = await fetch(signedUpload.data.url, {
            method: "PUT",
            headers: { "Content-Type": signedUpload.data.contentType, Origin: ORIGIN },
            body: payload
        });
        if (!upload.ok || upload.headers.get("access-control-allow-origin") !== ORIGIN) {
            throw new Error("Signed browser upload failed with HTTP " + upload.status + ".");
        }

        var populatedList = await backend("/storage/list?folder=files", "GET", undefined, 200);
        if (!populatedList.data.items.some(function (item) { return item.fullPath === objectPath; })) {
            throw new Error("Uploaded object was not returned by list.");
        }
        console.log("PASS signed upload and list");

        var signedDownload = await backend("/storage/download-url", "POST", { path: objectPath, download: false }, 200);
        var download = await fetch(signedDownload.data.url, { headers: { Origin: ORIGIN } });
        if (!download.ok || download.headers.get("access-control-allow-origin") !== ORIGIN || await download.text() !== payload) {
            throw new Error("Signed browser download did not return the uploaded payload with CORS access.");
        }
        console.log("PASS signed download");

        await backend("/storage/object", "DELETE", { path: objectPath }, 200);
        objectPath = "";
        var finalList = await backend("/storage/list?folder=files", "GET", undefined, 200);
        if (finalList.data.items.some(function (item) { return item.name === "e2e.txt"; })) {
            throw new Error("Deleted object is still present.");
        }
        console.log("PASS delete and cleanup verification");
    } finally {
        await cleanup();
        if (app) await app.delete().catch(function () {});
    }
}

run().catch(function (error) {
    console.error("FAIL " + error.message);
    process.exitCode = 1;
});
