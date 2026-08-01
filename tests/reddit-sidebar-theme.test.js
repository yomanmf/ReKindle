const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('saved subreddit column uses a pure background for dark-theme inversion', function () {
    var reddit = fs.readFileSync(path.join(__dirname, '..', 'reddit.html'), 'utf8');

    assert.match(reddit, /#saved-list\s*\{[^}]*background:\s*white;/);
});
