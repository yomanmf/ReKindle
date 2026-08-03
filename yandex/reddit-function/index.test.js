"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var reddit = require("./index.js");

function event(method, url) {
    return {
        httpMethod: method || "GET",
        queryStringParameters: url ? { url: url } : {}
    };
}

test("rejects missing and non-allowlisted targets", async function () {
    var missing = await reddit.handler(event("GET"));
    assert.equal(missing.statusCode, 400);

    var disallowed = await reddit.handler(event("GET", "https://example.com/r/test.rss"));
    assert.equal(disallowed.statusCode, 403);
});

test("extracts compact upvote counts only from Reddit embed pages", async function () {
    var html = '<a data-testid="upvote" href="https://www.reddit.com/r/test/comments/abc123/example/?utm_source=embed"><span><faceplate-number number="42" pretty></faceplate-number> upvotes</span></a>';
    assert.deepEqual(reddit.parseEmbedScores(html), { t3_abc123: 42 });

    var originalFetch = global.fetch;
    global.fetch = async function () {
        return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    };
    try {
        var request = event("GET", "https://embed.reddit.com/r/test?embed=true");
        request.queryStringParameters.extract = "scores";
        var result = await reddit.handler(request);
        assert.equal(result.statusCode, 200);
        assert.equal(result.headers["Content-Type"], "application/json; charset=utf-8");
        assert.deepEqual(JSON.parse(result.body), { t3_abc123: 42 });

        var rejected = event("GET", "https://www.reddit.com/r/test.rss");
        rejected.queryStringParameters.extract = "scores";
        assert.equal((await reddit.handler(rejected)).statusCode, 403);
    } finally {
        global.fetch = originalFetch;
    }
});

test("revalidates redirects against the Reddit and Imgur allowlist", async function () {
    var originalFetch = global.fetch;
    var calls = 0;
    global.fetch = async function () {
        calls++;
        return new Response("", { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    };
    try {
        var result = await reddit.handler(event("GET", "https://www.reddit.com/r/test.rss"));
        assert.equal(result.statusCode, 502);
        assert.equal(calls, 2);
        assert.match(result.body, /not allowed/i);
    } finally {
        global.fetch = originalFetch;
    }
});

test("rejects oversized upstream responses without caching them", async function () {
    var originalFetch = global.fetch;
    global.fetch = async function () {
        return new Response("too large", {
            status: 200,
            headers: {
                "Content-Type": "application/rss+xml",
                "Content-Length": String(5 * 1024 * 1024 + 1)
            }
        });
    };
    try {
        var result = await reddit.handler(event("GET", "https://old.reddit.com/r/oversized.rss"));
        assert.equal(result.statusCode, 502);
        assert.match(result.body, /5 MB limit/);
    } finally {
        global.fetch = originalFetch;
    }
});
