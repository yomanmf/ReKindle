'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var html = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');
var start = html.indexOf('function parseTopSubreddits(responseText)');
var end = html.indexOf('// --- UI MANAGER ---', start);
var context = {};
vm.runInNewContext(html.slice(start, end) + '\nthis.parseTopSubreddits = parseTopSubreddits;', context);

test('opens a Top button below saved subreddits', function() {
    assert.match(html, /id="saved-list"><\/div>\s*<button[^>]*onclick="ui\.loadTopSubreddits\(\)"/);
    assert.match(html, /data-i18n="reddit\.feed\.sort\.top">Top<\/button>/);
});

test('keeps the popular subreddit screen to 100 valid names', function() {
    var links = Array.from({ length: 102 }, function(_, index) {
        return '<entry><link href="https://old.reddit.com/r/sub' + index + '/" /></entry>';
    });
    links.splice(1, 0, '<entry><link href="https://example.com/not-a-sub/" /></entry>');
    var result = context.parseTopSubreddits('<feed>' + links.join('') + '</feed>');

    assert.equal(result.length, 100);
    assert.equal(result[0], 'sub0');
    assert.equal(result[1], 'sub1');
    assert.equal(result[99], 'sub99');
});

test('requests Reddit popular communities and opens a selected subreddit', function() {
    assert.match(html, /api\.request\('\/subreddits\/popular\.rss\?limit=100'\)/);
    assert.match(html, /document\.getElementById\('sub-input'\)\.value = sub;\s*ui\.loadCurrentSub\(\);/);
});
