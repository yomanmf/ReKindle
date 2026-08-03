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
    var json = JSON.stringify({ data: { children: [{ data: { title: 'JSON', created_utc: 1785587640 } }] } });

    assert.equal(context.formatPostDate(context.parseRssPosts(rss)[0].publishedAt), '2026-08-01 15:34');
    assert.equal(context.formatPostDate(context.parseRssPosts(atom)[0].publishedAt), '2026-08-01 15:34');
    assert.equal(context.formatPostDate(context.parseJsonPosts(json)[0].publishedAt), '2026-08-01 15:34');
});

test('puts the Moscow publication time at the right of every post header', function () {
    assert.match(html, /\.post-meta\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
    assert.equal((html.match(/class="post-date"/g) || []).length, 3);
});

test('keeps the publication time in the JSON thread fallback', function () {
    var payload = JSON.stringify([
        { data: { children: [{ data: { title: 'Thread', created_utc: 1785587640 } }] } },
        { data: { children: [] } }
    ]);

    assert.equal(comments.parseThread(payload).post.publishedAt, 1785587640000);
});
