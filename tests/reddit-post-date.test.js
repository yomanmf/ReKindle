'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var comments = require('../js/reddit-comments.js');

var html = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');
var start = html.indexOf('function extractPermalinkFromUrl');
var end = html.indexOf('function postFullnameFromPermalink', start);
var context = { URL: URL, Date: Date, isNaN: isNaN };
vm.runInNewContext(html.slice(start, end), context);

test('parses and formats Reddit publication dates from RSS, Atom, and JSON', function () {
    var rss = '<item><title>RSS</title><pubDate>Sat, 01 Aug 2026 12:34:00 GMT</pubDate></item>';
    var atom = '<entry><title>Atom</title><published>2026-08-01T12:34:00+00:00</published></entry>';
    var json = JSON.stringify({ data: { children: [{ data: { title: 'JSON', ups: 321, created_utc: 1785587640 } }] } });

    assert.equal(context.formatPostDate(context.parseRssPosts(rss)[0].publishedAt), '2026-08-01 15:34');
    assert.equal(context.formatPostDate(context.parseRssPosts(atom)[0].publishedAt), '2026-08-01 15:34');
    assert.equal(context.formatPostDate(context.parseJsonPosts(json)[0].publishedAt), '2026-08-01 15:34');
    assert.equal(context.parseJsonPosts(json)[0].upvotes, 321);
});

test('applies compact embed score maps to RSS posts', function () {
    var posts = context.parseRssPosts('<entry><id>t3_abc123</id><title>RSS</title></entry>');
    context.applyPostScores(posts, context.parseScoreMap('{"t3_abc123":42}'));

    assert.equal(posts[0].upvotes, 42);
    assert.equal(Object.keys(context.parseScoreMap('{bad json')).length, 0);
});

test('puts the upvote counter immediately before the Moscow publication time', function () {
    assert.match(html, /\.post-meta\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
    assert.match(context.renderPostFacts({ upvotes: 321, publishedAt: 1785587640000 }), /class="post-upvotes"[\s\S]*321[\s\S]*class="post-date"[\s\S]*2026-08-01 15:34/);
    assert.match(html, /class="post-upvotes"[^>]*><svg[^>]*aria-hidden="true"/);
    assert.equal((html.match(/\$\{renderPostFacts\((?:p|post)\)\}/g) || []).length, 3);
});

test('keeps upvotes and publication time in the JSON thread response', function () {
    var payload = JSON.stringify([
        { data: { children: [{ data: { title: 'Thread', ups: 654, created_utc: 1785587640 } }] } },
        { data: { children: [] } }
    ]);

    assert.equal(comments.parseThread(payload).post.publishedAt, 1785587640000);
    assert.equal(comments.parseThread(payload).post.upvotes, 654);
});

test('keeps RSS primary and enriches it through compact embed score requests', function () {
    var more = html.slice(html.indexOf('async loadMorePosts()'), html.indexOf('// FEED'));
    var feed = html.slice(html.indexOf('async loadCurrentSub()'), html.indexOf('async loadTopSubreddits()'));
    var thread = html.slice(html.indexOf('async loadThread(permalink)'), html.indexOf('processCommentHtml(html)'));

    assert.ok(more.indexOf('api.getSubreddit(') < more.indexOf('api.getSubredditJson('));
    assert.ok(feed.indexOf('api.getSubreddit(') < feed.indexOf('api.getSubredditJson('));
    assert.ok(thread.indexOf('api.getThread(') < thread.indexOf('api.getThreadJson('));
    assert.match(html, /baseUrl:\s*'https:\/\/embed\.reddit\.com'[\s\S]*extractScores:\s*true/);
    assert.match(html, /await loadPostScores\(posts,/);
    assert.match(thread, /await api\.getThreadScore\(permalink\)/);
});
