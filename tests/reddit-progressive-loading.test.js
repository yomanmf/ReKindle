'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var redditHtml = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');

function createApi(fetchImpl) {
    var start = redditHtml.indexOf('const REDDIT_PROXY_ENDPOINT');
    var end = redditHtml.indexOf('function extractPermalinkFromUrl', start);
    var source = redditHtml.slice(start, end).replace('const api =', 'globalThis.api =');
    var indicator = { innerText: '', style: {} };
    var context = {
        RekindleCloud: { gatewayBase: 'https://gateway.example' },
        document: { getElementById: function () { return indicator; } },
        window: {},
        fetch: fetchImpl,
        console: { log: function () {}, warn: function () {} },
        setTimeout: setTimeout,
        Promise: Promise,
        Date: Date,
        URL: URL
    };
    vm.runInNewContext(source, context);
    context.api.indicator = indicator;
    return context.api;
}

test('keeps the toolbar loading label hidden while opening a thread', async function () {
    var displays = [];
    var api = createApi(async function () {
        return { ok: true, status: 200, text: async function () { return 'ok'; } };
    });
    Object.defineProperty(api.indicator.style, 'display', {
        set: function (value) { displays.push(value); }
    });

    await api.getThread('/r/test/comments/abc/example/');
    await api.getThreadJson('/r/test/comments/abc/example/');
    assert.deepEqual(displays, []);
});

test('loads the versioned Reddit comment helper used by progressive enrichment', function () {
    assert.match(redditHtml, /<script src="js\/reddit-comments\.js\?v=4"><\/script>/);
});

test('renders the main Reddit thread before loading root metadata', function () {
    var loadThreadStart = redditHtml.indexOf('async loadThread(permalink)');
    var loadThreadEnd = redditHtml.indexOf('processCommentHtml(html)', loadThreadStart);
    var loadThreadSource = redditHtml.slice(loadThreadStart, loadThreadEnd);
    var renderIndex = loadThreadSource.indexOf('content.innerHTML = html.replace');
    var backgroundRootsIndex = loadThreadSource.indexOf('this.loadThreadRootsInBackground(permalink, comments)');

    assert.notEqual(loadThreadStart, -1);
    assert.notEqual(loadThreadEnd, -1);
    assert.notEqual(renderIndex, -1);
    assert.notEqual(backgroundRootsIndex, -1);
    assert.ok(renderIndex < backgroundRootsIndex);
    assert.doesNotMatch(loadThreadSource, /await\s+api\.getThreadRoots/);
});

test('allocates request IDs before the client throttle wait', function () {
    var requestStart = redditHtml.indexOf('async request(endpoint, options)');
    var requestEnd = redditHtml.indexOf('async getSubreddit(sub, after)', requestStart);
    var requestSource = redditHtml.slice(requestStart, requestEnd);
    var requestIdIndex = requestSource.indexOf('const requestId = ++this.currentRequestId');
    var throttleIndex = requestSource.indexOf('await this.sleep(this.minRequestInterval - timeSinceLast)');

    assert.notEqual(requestIdIndex, -1);
    assert.notEqual(throttleIndex, -1);
    assert.ok(requestIdIndex < throttleIndex);
});

test('foreground threads bypass the feed throttle', async function () {
    var sleeps = 0;
    var api = createApi(async function () {
        return { ok: true, status: 200, text: async function () { return 'ok'; } };
    });
    api.sleep = async function () { sleeps++; };

    api.lastRequestTime = Date.now();
    await api.getThread('/r/test/comments/abc/example/');
    assert.equal(sleeps, 0);

    api.lastRequestTime = Date.now();
    await api.request('/r/test.rss');
    assert.equal(sleeps, 1);
});

test('does not repeat proxy failures already retried by the backend', async function () {
    var fetches = 0;
    var api = createApi(async function () {
        fetches++;
        return { ok: false, status: 503 };
    });

    await assert.rejects(api.getThread('/r/test/comments/abc/example/'), /Status 503/);
    assert.equal(fetches, 1);
});

test('does not render a feed response superseded while its body is loading', async function () {
    var releaseFirstBody;
    var fetches = 0;
    var api = createApi(async function () {
        fetches++;
        if (fetches === 1) {
            return {
                ok: true,
                status: 200,
                text: function () {
                    return new Promise(function (resolve) { releaseFirstBody = resolve; });
                }
            };
        }
        return { ok: true, status: 200, text: async function () { return 'new'; } };
    });

    var staleRequest = api.request('/r/kindle?limit=25');
    while (!releaseFirstBody) await Promise.resolve();
    assert.equal(await api.getThread('/r/kindle/comments/new/thread/'), 'new');
    releaseFirstBody('stale');
    await assert.rejects(staleRequest, /superseded/);
});

test('ignores background root metadata after leaving the thread', function () {
    var backgroundStart = redditHtml.indexOf('loadThreadRootsInBackground(permalink, comments)');
    var backgroundEnd = redditHtml.indexOf('async loadMorePosts()', backgroundStart);
    var backgroundSource = redditHtml.slice(backgroundStart, backgroundEnd);

    assert.match(backgroundSource, /if \(this\.currentThread !== permalink\) return;/);
    assert.match(backgroundSource, /api\.getThreadRoots\(permalink, \{ silent: true \}\)/);
    assert.match(backgroundSource, /this\.applyRootCommentMarkers\(permalink, comments\)/);
    assert.match(backgroundSource, /rootLoadTimeout = setTimeout/);
    assert.match(backgroundSource, /}, 2500\);/);
    assert.ok(backgroundSource.indexOf('setTimeout') < backgroundSource.indexOf('api.getThreadRoots'));
});

test('cancels delayed root metadata when navigating', function () {
    var feedStart = redditHtml.indexOf('async loadCurrentSub()');
    var threadStart = redditHtml.indexOf('async loadThread(permalink)');
    var feedSource = redditHtml.slice(feedStart, threadStart);
    var threadSource = redditHtml.slice(threadStart, redditHtml.indexOf('processCommentHtml(html)', threadStart));

    assert.match(feedSource, /this\.cancelThreadRootLoad\(\)/);
    assert.match(threadSource, /this\.cancelThreadRootLoad\(\)/);
});

test('renders a cached subreddit feed before refreshing it', function () {
    var feedStart = redditHtml.indexOf('async loadCurrentSub()');
    var feedEnd = redditHtml.indexOf('async loadThread(permalink)', feedStart);
    var feedSource = redditHtml.slice(feedStart, feedEnd);
    var cachedRenderIndex = feedSource.indexOf('this.renderPostList(cachedPosts, sub, false)');
    var requestIndex = feedSource.indexOf('await api.getSubreddit(sub, null, preference)');

    assert.notEqual(cachedRenderIndex, -1);
    assert.notEqual(requestIndex, -1);
    assert.ok(cachedRenderIndex < requestIndex);
    assert.match(feedSource, /if \(cachedPosts\.length === 0\) \{/);
});
