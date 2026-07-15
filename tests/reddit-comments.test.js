'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var commentsParser = require('../js/reddit-comments.js');

test('flattens Reddit comment trees while preserving root markers and order', function () {
    var payload = [
        {
            data: {
                children: [{
                    kind: 't3',
                    data: {
                        title: 'Example post',
                        author: 'poster',
                        selftext_html: '&lt;div class="md"&gt;&lt;p&gt;Post body&lt;/p&gt;&lt;/div&gt;',
                        permalink: '/r/test/comments/abc/example/'
                    }
                }]
            }
        },
        {
            data: {
                children: [
                    {
                        kind: 't1',
                        data: {
                            name: 't1_root1',
                            parent_id: 't3_abc',
                            author: 'root-author',
                            body_html: '&lt;div class="md"&gt;&lt;p&gt;Root&lt;/p&gt;&lt;/div&gt;',
                            replies: {
                                data: {
                                    children: [
                                        {
                                            kind: 't1',
                                            data: {
                                                name: 't1_reply1',
                                                parent_id: 't1_root1',
                                                author: 'reply-author',
                                                body: 'Reply text',
                                                replies: {
                                                    data: {
                                                        children: [{
                                                            kind: 't1',
                                                            data: {
                                                                name: 't1_reply2',
                                                                parent_id: 't1_reply1',
                                                                author: 'nested-author',
                                                                body: 'Nested reply'
                                                            }
                                                        }]
                                                    }
                                                }
                                            }
                                        },
                                        { kind: 'more', data: { count: 2 } }
                                    ]
                                }
                            }
                        }
                    },
                    {
                        kind: 't1',
                        data: {
                            name: 't1_root2',
                            parent_id: 't3_abc',
                            author: null,
                            body: '[deleted]'
                        }
                    }
                ]
            }
        }
    ];

    var result = commentsParser.parseThread(JSON.stringify(payload));

    assert.equal(result.post.title, 'Example post');
    assert.match(result.post.contentHtml, /<p>Post body<\/p>/);
    assert.deepEqual(result.comments.map(function (comment) { return comment.id; }), [
        't1_root1',
        't1_reply1',
        't1_reply2',
        't1_root2'
    ]);
    assert.deepEqual(result.comments.map(function (comment) { return comment.depth; }), [0, 1, 2, 0]);
    assert.deepEqual(result.comments.map(function (comment) { return comment.isTopLevel; }), [true, false, false, true]);
    assert.equal(result.comments[3].author, '[deleted]');
});

test('returns an empty thread for malformed data', function () {
    assert.deepEqual(commentsParser.parseThread('{bad json'), { post: null, comments: [] });
    assert.deepEqual(commentsParser.parseThread('{}'), { post: null, comments: [] });
});

test('tracks the current root while scrolling and advances one root at a time', function () {
    var rootTops = [300, 700, 1100];

    assert.equal(commentsParser.resolveNavigationIndex(rootTops, 0, 500, 0, -1), -1);
    assert.equal(commentsParser.getNextRootIndex(-1, rootTops.length), 0);
    assert.equal(commentsParser.resolveNavigationIndex(rootTops, 310, 500, 0, 0), 0);
    assert.equal(commentsParser.getNextRootIndex(0, rootTops.length), 1);
    assert.equal(commentsParser.getNextRootIndex(2, rootTops.length), -1);
});

test('finds the current feed post and advances to the next thread in order', function () {
    var posts = [
        { permalink: '/r/test/comments/one/first/' },
        { permalink: '/r/test/comments/two/second/' },
        { permalink: '/r/test/comments/three/third/' }
    ];

    assert.equal(commentsParser.findPostIndex(posts, posts[1].permalink), 1);
    assert.equal(commentsParser.findPostIndex(posts, '/r/test/comments/missing/'), -1);
    assert.equal(commentsParser.getNextPostIndex(0, posts.length), 1);
    assert.equal(commentsParser.getNextPostIndex(2, posts.length), -1);
    assert.equal(commentsParser.getNextPostIndex(-1, 0), -1);
});

test('keeps a navigated root selected while it remains visible during an upward scroll', function () {
    var rootTops = [300, 700, 1100];

    assert.equal(commentsParser.resolveNavigationIndex(rootTops, 650, 500, 700, 2), 2);
    assert.equal(commentsParser.resolveNavigationIndex(rootTops, 500, 500, 650, 2), 0);
});

test('marks only IDs returned by the depth-one RSS feed as top-level comments', function () {
    var comments = [
        { id: 't1_root1', depth: 0, isTopLevel: true },
        { id: 't1_reply1', depth: 0, isTopLevel: true },
        { id: 't1_root2', depth: 0, isTopLevel: true },
        { id: 't1_reply2', depth: 0, isTopLevel: true }
    ];

    var markedCount = commentsParser.markTopLevelComments(comments, ['t1_root1', 't1_root2']);

    assert.equal(markedCount, 2);
    assert.deepEqual(comments.map(function (comment) { return comment.isTopLevel; }), [true, false, true, false]);
    assert.deepEqual(comments.map(function (comment) { return comment.depth; }), [0, 1, 0, 1]);
});
