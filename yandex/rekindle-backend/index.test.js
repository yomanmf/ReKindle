"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var backend = require("./index.js");

function event(method, path, origin, body) {
    return {
        httpMethod: method,
        path: path,
        headers: origin ? { Origin: origin } : {},
        requestContext: { identity: { sourceIp: "203.0.113.10" } },
        body: body === undefined ? "" : JSON.stringify(body),
        isBase64Encoded: false
    };
}

test("health endpoint is available from the production origin", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/health",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true, service: "rekindle-backend" });
});

test("preflight includes the Firebase token header", async function () {
    var result = await backend.handler(event(
        "OPTIONS",
        "/api/rekindle/storage/list",
        "https://rekindle.website.yandexcloud.net"
    ));
    assert.equal(result.statusCode, 204);
    assert.match(result.headers["Access-Control-Allow-Headers"], /X-Firebase-Token/);
});

test("unapproved browser origins are rejected", async function () {
    var result = await backend.handler(event(
        "GET",
        "/api/rekindle/health",
        "https://attacker.example"
    ));
    assert.equal(result.statusCode, 403);
});

test("registration validates input before accessing credentials", async function () {
    var result = await backend.handler(event(
        "POST",
        "/api/rekindle/auth/register",
        "https://rekindle.website.yandexcloud.net",
        { username: "admin", password: "123456" }
    ));
    assert.equal(result.statusCode, 400);
    assert.equal(JSON.parse(result.body).code, "invalid-argument");
});

test("storage requires a Firebase ID token", async function () {
    var storageEvent = event(
        "GET",
        "/api/rekindle/storage/list",
        "https://rekindle.website.yandexcloud.net"
    );
    storageEvent.queryStringParameters = { folder: "files" };
    var result = await backend.handler(storageEvent);
    assert.equal(result.statusCode, 401);
    assert.equal(JSON.parse(result.body).code, "unauthenticated");
});
