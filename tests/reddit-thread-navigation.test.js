'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var redditHtml = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');
var releaseManifest = fs.readFileSync(path.join(__dirname, '..', 'yandex', 'FRONTEND-RELEASE-MANIFEST.txt'), 'utf8');

test('renders an accessible next-thread button in the Reddit toolbar', function () {
    var nextButtonStyles = redditHtml.match(/\.next-thread-btn\s*\{([^}]*)\}/);

    assert.match(redditHtml, /class="nav-btn"[^>]*id="back-btn"[^>]*data-i18n-title="common\.back"[^>]*>&lt;<\/button>/);
    assert.doesNotMatch(redditHtml, /id="back-btn"[^>]*data-i18n="rss\.btn\.back"/);
    assert.match(redditHtml, /class="nav-btn next-thread-btn"[^>]*id="next-thread-btn"/);
    assert.match(redditHtml, /id="next-thread-btn"[^>]*onclick="ui\.goToNextThread\(\)"/);
    assert.match(redditHtml, /data-i18n-title="reddit\.thread\.next"/);
    assert.ok(nextButtonStyles);
    assert.match(nextButtonStyles[1], /display:\s*none/);
    assert.match(nextButtonStyles[1], /margin-left:\s*auto/);
    assert.doesNotMatch(nextButtonStyles[1], /(?:min-)?(?:width|height)|padding|font-size|line-height/);
    assert.match(redditHtml, /\.next-thread-btn\.visible\s*\{[^}]*display:\s*inline-block/);
});

test('keeps feed order for next-thread navigation', function () {
    var renderStart = redditHtml.indexOf('renderPostList(posts, sub, stale)');
    var renderEnd = redditHtml.indexOf('initScrollListener()', renderStart);
    var renderSource = redditHtml.slice(renderStart, renderEnd);
    var loadMoreStart = redditHtml.indexOf('async loadMorePosts()');
    var loadMoreEnd = redditHtml.indexOf('// FEED', loadMoreStart);
    var loadMoreSource = redditHtml.slice(loadMoreStart, loadMoreEnd);
    var nextStart = redditHtml.indexOf('            goToNextThread() {');
    var nextEnd = redditHtml.indexOf('rootCommentIconHtml()', nextStart);
    var nextSource = redditHtml.slice(nextStart, nextEnd);

    assert.match(renderSource, /this\.feedPosts = posts\.slice\(\)/);
    assert.match(loadMoreSource, /this\.feedPosts = this\.feedPosts\.concat\(posts\)/);
    assert.match(nextSource, /getNextPostIndex\(/);
    assert.match(nextSource, /this\.loadThread\(this\.feedPosts\[nextIndex\]\.permalink\)/);
});

test('shows navigation only in thread mode and restores its feed context', function () {
    var updateStart = redditHtml.indexOf('            updateThreadNavigation() {');
    var updateEnd = redditHtml.indexOf('            goToNextThread() {', updateStart);
    var updateSource = redditHtml.slice(updateStart, updateEnd);
    var saveStart = redditHtml.indexOf('saveReturnState()');
    var saveEnd = redditHtml.indexOf('restoreReturnState()', saveStart);
    var saveSource = redditHtml.slice(saveStart, saveEnd);
    var restoreStart = redditHtml.indexOf('restoreReturnState()');
    var restoreSource = redditHtml.slice(restoreStart);

    assert.match(updateSource, /if \(!this\.currentThread\)/);
    assert.match(updateSource, /button\.classList\.remove\('visible'\)/);
    assert.match(updateSource, /button\.classList\.add\('visible'\)/);
    assert.match(updateSource, /button\.disabled = this\.isThreadLoading \|\| nextIndex === -1/);
    assert.match(saveSource, /feedPermalinks:/);
    assert.match(restoreSource, /Array\.isArray\(state\.feedPermalinks\)/);
});

test('ships the versioned navigation helper with the Yandex frontend release', function () {
    assert.match(releaseManifest, /^js\/reddit-comments\.js$/m);
    assert.match(redditHtml, /<script src="js\/reddit-comments\.js\?v=3"><\/script>/);
});

test('keeps external thread links on the extensionless browser route', function () {
    assert.match(redditHtml, /window\.location\.href = 'browser\?lite=true&return=\/reddit&url=' \+ encodeURIComponent\(url\)/);
    assert.doesNotMatch(redditHtml, /browser\.html\?lite=true/);
    assert.match(releaseManifest, /^theme\.js$/m);
});
