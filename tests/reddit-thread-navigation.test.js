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
    assert.match(nextButtonStyles[1], /margin-left:\s*24px/);
    assert.doesNotMatch(nextButtonStyles[1], /(?:min-)?(?:width|height)|padding|font-size|line-height/);
    assert.match(redditHtml, /\.next-thread-btn\.visible\s*\{[^}]*display:\s*inline-block/);
});

test('renders a right-aligned feed scroll-to-top button beside sorting controls', function () {
    var topButtonStyles = redditHtml.match(/\.feed-top-btn\s*\{([^}]*)\}/);

    assert.match(redditHtml, /class="nav-btn feed-top-btn"[^>]*onclick="document\.getElementById\('content-area'\)\.scrollTop = 0"[^>]*>\^<\/button>/);
    assert.ok(topButtonStyles);
    assert.match(topButtonStyles[1], /margin-left:\s*auto/);
    assert.match(topButtonStyles[1], /min-width:\s*48px/);
    assert.match(topButtonStyles[1], /min-height:\s*48px/);
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

test('restores the last Reddit view after reopening the app', function () {
    var restoreStart = redditHtml.indexOf('restoreReturnState()');
    var restoreSource = redditHtml.slice(restoreStart);

    assert.match(redditHtml, /window\.addEventListener\('pagehide', function\(\) \{ ui\.saveReturnState\(\); \}\)/);
    assert.doesNotMatch(restoreSource, /localStorage\.removeItem\('reddit_return_state'\)/);
    assert.doesNotMatch(restoreSource, /Date\.now\(\) - state\.savedAt/);
});

test('keeps feed scroll separate from thread scroll', function () {
    var threadStart = redditHtml.indexOf('async loadThread(permalink)');
    var threadSource = redditHtml.slice(threadStart, redditHtml.indexOf('processCommentHtml(html)', threadStart));
    var backStart = redditHtml.indexOf('            goBack() {');
    var backSource = redditHtml.slice(backStart, redditHtml.indexOf('            saveReturnState() {', backStart));
    var saveStart = redditHtml.indexOf('            saveReturnState() {');
    var saveSource = redditHtml.slice(saveStart, redditHtml.indexOf('            restoreReturnState() {', saveStart));
    var restoreStart = redditHtml.indexOf('            restoreReturnState() {');
    var restoreSource = redditHtml.slice(restoreStart);

    assert.match(threadSource, /if \(!this\.currentThread\) this\.feedScrollTop = content\.scrollTop/);
    assert.match(backSource, /content\.scrollTop = feedScrollTop/);
    assert.match(backSource, /if \(!ui\.currentThread\) content\.scrollTop = feedScrollTop/);
    assert.match(saveSource, /feedScrollTop: this\.currentThread \? this\.feedScrollTop/);
    assert.match(restoreSource, /state\.feedScrollTop !== undefined/);
});

test('ships the versioned navigation helper with the Yandex frontend release', function () {
    assert.match(releaseManifest, /^js\/reddit-comments\.js$/m);
    assert.match(redditHtml, /<script src="js\/reddit-comments\.js\?v=6"><\/script>/);
});

test('keeps external thread links on the extensionless browser route', function () {
    assert.match(redditHtml, /window\.location\.href = 'browser\?lite=true&return=\/reddit&url=' \+ encodeURIComponent\(url\)/);
    assert.doesNotMatch(redditHtml, /browser\.html\?lite=true/);
    assert.match(releaseManifest, /^theme\.js$/m);
});
