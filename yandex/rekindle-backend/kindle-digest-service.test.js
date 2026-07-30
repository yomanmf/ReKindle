"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var service = require("./kindle-digest-service");

function memoryFirestore() {
    var values = new Map();
    function reference(path) {
        return {
            get: async function () {
                return { exists: values.has(path), data: function () { return values.get(path); } };
            },
            set: async function (value, options) {
                var next = options && options.merge ? Object.assign({}, values.get(path) || {}, value) : value;
                values.set(path, JSON.parse(JSON.stringify(next)));
            },
            update: async function (value) {
                if (!values.has(path)) throw new Error("missing document");
                values.set(path, Object.assign({}, values.get(path), JSON.parse(JSON.stringify(value))));
            }
        };
    }
    return {
        doc: reference,
        collection: function (name) {
            return {
                doc: function (id) { return reference(name + "/" + id); },
                limit: function () {
                    return {
                        get: async function () {
                            var docs = [];
                            values.forEach(function (value, path) {
                                if (path.indexOf(name + "/") !== 0 || path.slice(name.length + 1).indexOf("/") !== -1) return;
                                docs.push({ id: path.slice(name.length + 1), data: function () { return value; } });
                            });
                            return { docs: docs };
                        }
                    };
                }
            };
        }
    };
}

test("Kindle Digest runs a direct worker job without Telegram", async function () {
    var firestore = memoryFirestore();
    var env = { KINDLE_DIGEST_ALLOWED_UIDS: "owner-uid", KINDLE_DIGEST_WORKER_SECRET: "worker-secret" };
    var worker = function (action, body) {
        return service.handle({
            action: action,
            body: body || {},
            worker: true,
            workerToken: "Bearer worker-secret",
            firestore: firestore,
            env: env
        });
    };
    var user = function (action, body) {
        return service.handle({ action: action, body: body || {}, uid: "owner-uid", firestore: firestore, env: env });
    };

    await worker("sync", { sources: [{ id: "the-verge", label: "The Verge", url: "https://www.theverge.com/rss/index.xml" }] });
    var created = await user("create", {
        mode: "daily", sourceId: "the-verge", lookbackDays: 3, filter: "important", articleLimit: 5
    });
    assert.equal(created.existing, false);
    assert.equal(created.job.state, "queued");
    assert.equal((await user("create", {
        mode: "digest", lookbackDays: 1, filter: "all", articleLimit: 2
    })).existing, true);

    var pulled = await worker("pull");
    assert.equal(pulled.job.id, created.job.id);
    assert.equal(pulled.job.url, "https://www.theverge.com/rss/index.xml");
    await worker("progress", { id: created.job.id, phase: "collecting", message: "Rendering article 2/5", current: 2, total: 5 });
    var running = (await user("status", { id: created.job.id })).job;
    assert.equal(running.state, "running");
    assert.equal(running.phase, "collecting");
    assert.equal(running.current, 2);

    await user("cancel", { id: created.job.id });
    assert.equal((await worker("check", { id: created.job.id })).cancelRequested, true);
    await worker("canceled", { id: created.job.id });
    assert.equal((await user("status", { id: created.job.id })).job.state, "canceled");
    assert.equal((await worker("finish", { id: created.job.id })).cancelRequested, true);

    await user("retry", { id: created.job.id });
    await worker("progress", { id: created.job.id, phase: "sending", message: "Sending EPUB to Kindle" });
    await worker("finish", {
        id: created.job.id,
        message: "EPUB was sent to Kindle.",
        result: { articleCount: 5, fileCount: 1, sizeBytes: 12345, delivery: "email" }
    });
    var complete = (await user("status", { id: created.job.id })).job;
    assert.equal(complete.state, "sent");
    assert.equal(complete.result.articleCount, 5);
    await worker("fail", { id: created.job.id, error: "late failure" });
    assert.equal((await user("status", { id: created.job.id })).job.state, "sent");
    assert.equal((await user("history")).items.length, 1);
});

test("Kindle Digest rejects unknown users, worker secrets, and unsafe URLs", async function () {
    var firestore = memoryFirestore();
    var env = { KINDLE_DIGEST_ALLOWED_UIDS: "owner-uid", KINDLE_DIGEST_WORKER_SECRET: "worker-secret" };
    await assert.rejects(
        service.handle({ action: "options", uid: "other", firestore: firestore, env: env }),
        function (error) { return error.status === 403; }
    );
    await assert.rejects(
        service.handle({ action: "pull", worker: true, workerToken: "Bearer wrong", firestore: firestore, env: env }),
        function (error) { return error.status === 401; }
    );
    assert.throws(function () {
        service.testHooks.validatePublicHttpUrl("http://user:pass@example.com/");
    });
    assert.throws(function () {
        service.testHooks.validatePublicHttpUrl("https://example.com:8443/feed");
    });
});
