(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RekindleRedditFeedSettings = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var SORTS = ['hot', 'new', 'top', 'rising', 'controversial'];
    var TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'];

    function contains(values, value) {
        return values.indexOf(value) !== -1;
    }

    function subredditKey(subreddit) {
        var value = String(subreddit || 'popular').trim().toLowerCase();
        value = value.replace(/^r\//, '');
        return value.replace(/[^a-z0-9_]+/g, '_') || 'popular';
    }

    function normalizePreference(preference) {
        preference = preference || {};
        var sort = String(preference.sort || '').toLowerCase();
        var time = String(preference.time || '').toLowerCase();
        return {
            sort: contains(SORTS, sort) ? sort : 'hot',
            time: contains(TIMES, time) ? time : 'day'
        };
    }

    function normalizePreferences(preferences) {
        var normalized = {};
        if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return normalized;
        Object.keys(preferences).forEach(function (key) {
            normalized[subredditKey(key)] = normalizePreference(preferences[key]);
        });
        return normalized;
    }

    function usesTime(sort) {
        return sort === 'top' || sort === 'controversial';
    }

    function buildFeedEndpoint(subreddit, preference, after, json) {
        var pref = normalizePreference(preference);
        var path = '/r/' + String(subreddit || 'popular').replace(/^r\//, '');
        if (pref.sort !== 'hot') path += '/' + pref.sort;
        if (json) path += '.json';

        var query = ['limit=25'];
        if (after) query.push('after=' + encodeURIComponent(after));
        if (usesTime(pref.sort)) query.push('t=' + encodeURIComponent(pref.time));
        return path + '?' + query.join('&');
    }

    function cacheKey(subreddit, preference) {
        var pref = normalizePreference(preference);
        var time = usesTime(pref.sort) ? pref.time : 'none';
        return 'reddit_feed_xml_v2_' + subredditKey(subreddit) + '_' + pref.sort + '_' + time;
    }

    return {
        SORTS: SORTS.slice(),
        TIMES: TIMES.slice(),
        subredditKey: subredditKey,
        normalizePreference: normalizePreference,
        normalizePreferences: normalizePreferences,
        usesTime: usesTime,
        buildFeedEndpoint: buildFeedEndpoint,
        cacheKey: cacheKey
    };
}));
