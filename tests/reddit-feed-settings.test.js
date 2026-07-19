'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var settings = require('../js/reddit-feed-settings.js');

var root = path.join(__dirname, '..');
var redditHtml = fs.readFileSync(path.join(root, 'reddit.html'), 'utf8');
var releaseManifest = fs.readFileSync(path.join(root, 'yandex', 'FRONTEND-RELEASE-MANIFEST.txt'), 'utf8');

test('normalizes subreddit-specific feed preferences', function () {
    assert.deepEqual(settings.normalizePreference({ sort: 'TOP', time: 'week' }), { sort: 'top', time: 'week' });
    assert.deepEqual(settings.normalizePreference({ sort: 'invalid', time: 'forever' }), { sort: 'hot', time: 'day' });
    assert.equal(settings.subredditKey('r/Kindle'), 'kindle');
});

test('builds Reddit feed endpoints for every sorting mode', function () {
    assert.equal(settings.buildFeedEndpoint('kindle', { sort: 'hot' }, null, false), '/r/kindle?limit=25');
    assert.equal(settings.buildFeedEndpoint('kindle', { sort: 'new' }, 't3_abc', true), '/r/kindle/new.json?limit=25&after=t3_abc');
    assert.equal(settings.buildFeedEndpoint('kindle', { sort: 'top', time: 'month' }, null, false), '/r/kindle/top?limit=25&t=month');
    assert.equal(settings.buildFeedEndpoint('kindle', { sort: 'controversial', time: 'all' }, null, true), '/r/kindle/controversial.json?limit=25&t=all');
});

test('separates cached feeds by subreddit, sorting mode, and period', function () {
    assert.notEqual(settings.cacheKey('kindle', { sort: 'hot' }), settings.cacheKey('kindle', { sort: 'new' }));
    assert.notEqual(settings.cacheKey('kindle', { sort: 'top', time: 'day' }), settings.cacheKey('kindle', { sort: 'top', time: 'week' }));
    assert.notEqual(settings.cacheKey('kindle', { sort: 'hot' }), settings.cacheKey('books', { sort: 'hot' }));
});

test('renders feed controls and persists a map through local and Firebase storage', function () {
    assert.match(redditHtml, /id="feed-sort-select"[^>]*onchange="ui\.changeFeedSort\(\)"/);
    assert.match(redditHtml, /id="feed-time-select"[^>]*onchange="ui\.changeFeedTime\(\)"/);
    assert.match(redditHtml, /reddit_feed_preferences_v1/);
    assert.match(redditHtml, /feed_preferences:\s*this\.feedPreferences/);
    assert.match(redditHtml, /previousPreference\.sort !== syncedPreference\.sort/);
    assert.match(redditHtml, /RekindleRedditFeedSettings\.cacheKey\(sub, preference\)/);
});

test('ships the feed settings helper in the frontend release', function () {
    assert.match(redditHtml, /<script src="js\/reddit-feed-settings\.js\?v=1"><\/script>/);
    assert.match(releaseManifest, /^js\/reddit-feed-settings\.js$/m);
});
