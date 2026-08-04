const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('saved subreddit column uses a pure background for dark-theme inversion', function () {
    var reddit = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');

    assert.match(reddit, /#saved-list\s*\{[^}]*background:\s*white;/);
    assert.match(reddit, /\.sidebar-item\.active\s*\{[^}]*background:\s*#ccc;[^}]*color:\s*black;/);
    assert.match(reddit, /\.sidebar-item\.active \.del-sub-btn\s*\{[^}]*color:\s*#666;/);
});

test('applies the saved theme before loading external Firebase scripts', function () {
    var reddit = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');

    assert.ok(reddit.indexOf('theme.js?v=25') < reddit.indexOf('www.gstatic.com/firebasejs'));
});
