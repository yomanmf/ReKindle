"use strict";

var ACTIONS = {
    search: true,
    series: true,
    create: true,
    status: true,
    cancel: true,
    retry: true,
    "kindle-status": true,
    "kindle-connect": true
};

async function handle(options) {
    options = options || {};
    var action = String(options.action || "");
    var env = options.env || process.env;
    if (!ACTIONS[action]) throw serviceError(404, "manga-kindle-action", "Manga to Kindle action was not found.");
    requireAllowedUser(options.uid, env);

    var baseUrl = required(env.MANGA_ORCHESTRATOR_URL || env.ANALYTICS_URL, "Manga orchestrator URL").replace(/\/+$/, "");
    var token = required(env.MANGA_CONTROL_TOKEN || env.ANALYTICS_INGEST_TOKEN, "Manga control token");
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 15000);
    var upstream;
    try {
        upstream = await fetch(baseUrl + "/control/" + action, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(options.body || {}),
            signal: controller.signal
        });
    } catch (error) {
        throw serviceError(502, "manga-kindle-unavailable", "Manga to Kindle is unavailable.");
    } finally {
        clearTimeout(timeout);
    }

    var data = await upstream.json().catch(function () { return {}; });
    if (!upstream.ok) {
        throw serviceError(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502,
            "manga-kindle-upstream", String(data.error || "Manga orchestrator rejected the request.").slice(0, 500));
    }
    return data;
}

function requireAllowedUser(uid, env) {
    var configured = String(env.MANGA_KINDLE_ALLOWED_UIDS || env.KINDLE_DIGEST_ALLOWED_UIDS || "");
    var allowed = configured.split(",").map(function (value) { return value.trim(); }).filter(Boolean);
    if (!allowed.length) throw serviceError(503, "manga-kindle-configuration", "Manga to Kindle is not configured.");
    if (allowed.indexOf(String(uid || "")) === -1) throw serviceError(403, "manga-kindle-forbidden", "Manga to Kindle is not enabled for this account.");
}

function required(value, label) {
    value = String(value || "").trim();
    if (!value) throw serviceError(503, "manga-kindle-configuration", label + " is not configured.");
    return value;
}

function serviceError(status, code, message) {
    var error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

module.exports = { handle: handle };
