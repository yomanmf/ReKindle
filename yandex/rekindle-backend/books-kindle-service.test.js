"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var service = require("./books-kindle-service");

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
                limit: function (maximum) {
                    return {
                        get: async function () {
                            var docs = [];
                            values.forEach(function (value, path) {
                                if (path.indexOf(name + "/") !== 0 || path.slice(name.length + 1).indexOf("/") !== -1) return;
                                docs.push({ id: path.slice(name.length + 1), data: function () { return value; } });
                            });
                            return { docs: docs.slice(0, maximum) };
                        }
                    };
                }
            };
        }
    };
}

test("Books to Kindle searches and delivers through the private worker queue", async function () {
    var firestore = memoryFirestore();
    var events = [];
    var publish = async function (event) { events.push(event); };
    var env = {
        KINDLE_DIGEST_ALLOWED_UIDS: "owner",
        KINDLE_DIGEST_WORKER_SECRET: "secret",
        BOOKS_KINDLE_QUEUE_URL: "https://message-queue.example/books.fifo"
    };
    var user = function (action, body) {
        return service.handle({ action: action, body: body || {}, uid: "owner", firestore: firestore, env: env, publish: publish });
    };
    var worker = function (action, body) {
        return service.handle({
            action: action,
            body: body || {},
            worker: true,
            workerToken: "Bearer secret",
            firestore: firestore,
            env: env
        });
    };

    await worker("sync", { sender: "books@example.com" });
    await user("kindle-set", { email: "reader@kindle.com" });
    var search = await user("search", { query: "War and Peace" });
    assert.equal(search.job.state, "queued");
    assert.equal(events.length, 1);
    var searchClaim = await worker("claim", { id: events[0].id, dispatchId: events[0].dispatchId });
    assert.equal(searchClaim.job.action, "search");
    assert.equal((await worker("claim", { id: search.job.id, dispatchId: "stale-dispatch" })).job, null);
    await worker("progress", { id: search.job.id, phase: "searching", message: "Searching" });
    await worker("search-results", {
        id: search.job.id,
        message: "Search results received from the Flibusta API.",
        results: [{
            id: "42",
            title: "War and Peace",
            author: "Leo Tolstoy",
            pageUrl: "http://flibusta.example/b/42",
            epubUrl: "http://flibusta.example/b/42/epub"
        }]
    });
    var ready = (await user("status", { id: search.job.id })).job;
    assert.equal(ready.state, "ready");
    assert.equal(ready.firstPageOnly, false);
    assert.equal(ready.message, "Search results received from the Flibusta API.");
    assert.deepEqual(ready.results[0].formats, ["EPUB"]);
    assert.equal(ready.results[0].epubUrl, undefined);

    await user("create", { id: search.job.id, bookId: "42" });
    var deliveryEvent = events[1];
    var delivery = (await worker("claim", { id: deliveryEvent.id, dispatchId: deliveryEvent.dispatchId })).job;
    assert.equal(delivery.action, "deliver");
    assert.equal(delivery.kindleEmail, "reader@kindle.com");
    await worker("progress", { id: search.job.id, phase: "sending", message: "Sending" });
    await worker("finish", { id: search.job.id, format: "epub" });
    assert.equal((await user("status", { id: search.job.id })).job.state, "sent");

    var limitedSearch = await user("search", { query: "Unknown Book" });
    var limitedEvent = events[2];
    await worker("claim", { id: limitedEvent.id, dispatchId: limitedEvent.dispatchId });
    await worker("search-results", {
        id: limitedSearch.job.id,
        results: [],
        firstPageOnly: true
    });
    var limitedReady = (await user("status", { id: limitedSearch.job.id })).job;
    assert.equal(limitedReady.state, "ready");
    assert.equal(limitedReady.firstPageOnly, true);
});

test("Books to Kindle rejects unknown users and invalid worker data", async function () {
    var firestore = memoryFirestore();
    var env = { BOOKS_KINDLE_ALLOWED_UIDS: "owner", BOOKS_KINDLE_WORKER_SECRET: "secret" };
    await assert.rejects(
        service.handle({ action: "status", uid: "other", firestore: firestore, env: env }),
        function (error) { return error.status === 403; }
    );
    await assert.rejects(
        service.handle({ action: "pull", worker: true, workerToken: "Bearer wrong", firestore: firestore, env: env }),
        function (error) { return error.status === 401; }
    );
    assert.throws(function () {
        service.testHooks.validateWorkerBook({ id: "42", title: "Book", pageUrl: "file:///tmp/book", epubUrl: "https://example.com/book" });
    });
});


test("Status by ID survives more than 100 jobs and verifies ownership", async function () {
    var firestore = memoryFirestore();
    for (var i = 0; i < 101; i++) {
        await firestore.collection("books_kindle_jobs").doc("job-" + i).set({
            uid: "owner", state: "ready", query: "Book " + i, createdAt: i
        });
    }
    var options = { action: "status", body: {id:"job-100"}, uid:"owner",
        firestore:firestore, env:{KINDLE_DIGEST_ALLOWED_UIDS:"owner,other"} };
    var result = await service.handle(options);
    assert.equal(result.job.id, "job-100");
    assert.equal(result.job.state, "ready");
    await assert.rejects(service.handle(Object.assign({}, options, {uid:"other"})),
        function (error) { return error.status === 404; });
});
