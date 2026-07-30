"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var service = require("./manga-kindle-service");

test("proxies an allowed ReKindle user to the direct manga control route", async function () {
    var originalFetch = global.fetch;
    var request;
    global.fetch = async function (url, options) {
        request = { url: url, options: options };
        return { ok: true, status: 200, json: async function () { return { results: [] }; } };
    };
    try {
        var result = await service.handle({
            action: "search",
            body: { query: "Fable" },
            uid: "owner",
            env: {
                MANGA_KINDLE_ALLOWED_UIDS: "owner",
                MANGA_ORCHESTRATOR_URL: "https://manga.example/",
                MANGA_CONTROL_TOKEN: "secret"
            }
        });
        assert.deepEqual(result, { results: [] });
        assert.equal(request.url, "https://manga.example/control/search");
        assert.equal(request.options.headers.Authorization, "Bearer secret");
    } finally {
        global.fetch = originalFetch;
    }
});

test("rejects users outside the allowlist before contacting the worker", async function () {
    await assert.rejects(service.handle({
        action: "status",
        uid: "other",
        env: { MANGA_KINDLE_ALLOWED_UIDS: "owner" }
    }), function (error) {
        return error.status === 403 && error.code === "manga-kindle-forbidden";
    });
});
