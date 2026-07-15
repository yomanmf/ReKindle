'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var redditHtml = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');

test('loads the versioned Reddit comment helper used by progressive enrichment', function () {
    assert.match(redditHtml, /<script src="js\/reddit-comments\.js\?v=2"><\/script>/);
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

test('ignores background root metadata after leaving the thread', function () {
    var backgroundStart = redditHtml.indexOf('loadThreadRootsInBackground(permalink, comments)');
    var backgroundEnd = redditHtml.indexOf('async loadMorePosts()', backgroundStart);
    var backgroundSource = redditHtml.slice(backgroundStart, backgroundEnd);

    assert.match(backgroundSource, /if \(this\.currentThread !== permalink\) return;/);
    assert.match(backgroundSource, /api\.getThreadRoots\(permalink, \{ silent: true \}\)/);
    assert.match(backgroundSource, /this\.applyRootCommentMarkers\(permalink, comments\)/);
});
