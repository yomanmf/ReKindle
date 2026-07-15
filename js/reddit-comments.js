(function (root, factory) {
    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.RekindleRedditComments = api;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function decodeHtmlEntities(text) {
        return String(text || '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'");
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function fallbackBodyHtml(text) {
        if (!text) return '';
        return '<p>' + escapeHtml(text).replace(/\r?\n/g, '<br>') + '</p>';
    }

    function appendComments(children, depth, output) {
        if (!Array.isArray(children)) return;

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (!child || child.kind !== 't1' || !child.data) continue;

            var data = child.data;
            output.push({
                id: data.name || (data.id ? 't1_' + data.id : ''),
                parentId: data.parent_id || '',
                author: data.author || '[deleted]',
                bodyHtml: data.body_html ? decodeHtmlEntities(data.body_html) : fallbackBodyHtml(data.body),
                permalink: data.permalink || '',
                depth: depth,
                isTopLevel: depth === 0
            });

            var replies = data.replies;
            if (replies && typeof replies === 'object' && replies.data) {
                appendComments(replies.data.children, depth + 1, output);
            }
        }
    }

    function parseThread(jsonText) {
        try {
            var payload = JSON.parse(jsonText);
            if (!Array.isArray(payload) || payload.length < 2) {
                return { post: null, comments: [] };
            }

            var postChildren = payload[0].data && payload[0].data.children;
            var commentChildren = payload[1].data && payload[1].data.children;
            var postData = postChildren && postChildren[0] ? postChildren[0].data : null;
            var post = postData ? {
                title: postData.title || '',
                author: postData.author || '',
                contentHtml: postData.selftext_html ? decodeHtmlEntities(postData.selftext_html) : fallbackBodyHtml(postData.selftext),
                permalink: postData.permalink || ''
            } : null;
            var comments = [];

            appendComments(commentChildren, 0, comments);
            return { post: post, comments: comments };
        } catch (e) {
            return { post: null, comments: [] };
        }
    }

    function resolveNavigationIndex(rootTops, scrollTop, viewportHeight, lastScrollTop, currentIndex) {
        var detectedIndex = -1;
        var markerTop = scrollTop + 12;
        for (var i = 0; i < rootTops.length; i++) {
            if (rootTops[i] <= markerTop) detectedIndex = i;
            else break;
        }

        if (scrollTop < lastScrollTop) {
            var currentRootTop = currentIndex >= 0 && currentIndex < rootTops.length ? rootTops[currentIndex] : null;
            var currentRootIsVisible = currentRootTop !== null && currentRootTop < scrollTop + viewportHeight;
            return currentRootIsVisible ? currentIndex : detectedIndex;
        }

        return detectedIndex > currentIndex ? detectedIndex : currentIndex;
    }

    function getNextRootIndex(currentIndex, rootCount) {
        var nextIndex = currentIndex + 1;
        return nextIndex >= 0 && nextIndex < rootCount ? nextIndex : -1;
    }

    function findPostIndex(posts, permalink) {
        if (!Array.isArray(posts) || !permalink) return -1;

        for (var i = 0; i < posts.length; i++) {
            if (posts[i] && posts[i].permalink === permalink) return i;
        }

        return -1;
    }

    function getNextPostIndex(currentIndex, postCount) {
        var nextIndex = currentIndex + 1;
        return nextIndex >= 0 && nextIndex < postCount ? nextIndex : -1;
    }

    function markTopLevelComments(comments, rootIds) {
        var rootLookup = Object.create(null);
        var markedCount = 0;

        for (var i = 0; i < rootIds.length; i++) {
            if (rootIds[i]) rootLookup[rootIds[i]] = true;
        }

        for (var j = 0; j < comments.length; j++) {
            var isTopLevel = !!rootLookup[comments[j].id];
            comments[j].isTopLevel = isTopLevel;
            comments[j].depth = isTopLevel ? 0 : 1;
            if (isTopLevel) markedCount++;
        }

        return markedCount;
    }

    return {
        parseThread: parseThread,
        resolveNavigationIndex: resolveNavigationIndex,
        getNextRootIndex: getNextRootIndex,
        findPostIndex: findPostIndex,
        getNextPostIndex: getNextPostIndex,
        markTopLevelComments: markTopLevelComments
    };
}));
