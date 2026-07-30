(function () {
    "use strict";

    var API_PATH = "/kindle-digest/";
    var currentJob = null;
    var signedIn = false;
    var pollTimer = null;
    var STATUS_ICONS = {
        waiting: '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2"></path>',
        extracting: '<rect x="4" y="3" width="13" height="18"></rect><path d="M7 8h7M7 12h6M15 17l6 6M18 14a4 4 0 1 0 0 8"></path>',
        building: '<path d="M4 5h13v18H4zM8 9h5M8 13h5M20 9v12M16 17l4 4 4-4"></path>',
        sending: '<path d="M3 11L21 3l-7 18-3-7-8-3zM11 14L21 3"></path>',
        sent: '<path d="M3 6h18v12H3zM3 7l9 7 9-7M15 18l2 2 4-5"></path>',
        failed: '<circle cx="12" cy="12" r="9"></circle><path d="M8 8l8 8M16 8l-8 8"></path>',
        canceled: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8zM8 12h8"></path>',
        running: '<circle cx="12" cy="12" r="9"></circle><path d="M7 12h10M13 8l4 4-4 4"></path>'
    };

    function byId(id) { return document.getElementById(id); }
    function translate(key, fallback) { return typeof window.t === "function" ? window.t(key, fallback) : fallback; }
    function setText(element, value) { if (element) element.textContent = value === undefined || value === null ? "" : String(value); }
    function setStatusValue(element, icon, value) {
        element.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true">' + (STATUS_ICONS[icon] || STATUS_ICONS.waiting) + '</svg><span></span>';
        setText(element.lastChild, value);
    }
    function request(action, body) { return window.RekindleCloud.request(API_PATH + action, { method: "POST", body: body || {} }); }
    function terminal(job) { return job && (job.state === "sent" || job.state === "failed" || job.state === "canceled"); }
    function setStatus(value) { setText(byId("status-bar"), value); }

    function showError(error) {
        setText(byId("error-message"), error && error.message || translate("kindlearticles.error_connection", "Could not reach Article to Kindle."));
        byId("error-modal").style.display = "flex";
    }

    function setBusy(busy) {
        var button = byId("submit-button");
        button.disabled = busy || !signedIn;
        setText(button, busy ? translate("kindlearticles.submitting", "Submitting...") : translate("kindlearticles.submit", "Create EPUB and send"));
    }

    function initializeFirebase() {
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) return showSignedOut();
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleKindleArticlesFirebaseConfig);
            firebase.auth().onAuthStateChanged(function (user) {
                signedIn = Boolean(user);
                byId("auth-notice").hidden = signedIn;
                byId("article-form").hidden = !signedIn;
                setBusy(false);
                if (!signedIn) return showSignedOut();
                loadAll();
            }, showSignedOut);
        } catch (error) { showSignedOut(); }
    }

    function showSignedOut() {
        signedIn = false;
        stopPolling();
        byId("auth-notice").hidden = false;
        byId("article-form").hidden = true;
        byId("job-panel").hidden = true;
        setStatus(translate("kindlearticles.signin", "Sign in to ReKindle before sending an article."));
    }

    async function loadAll() {
        setStatus(translate("kindlearticles.loading", "Loading Article to Kindle..."));
        try {
            var results = await Promise.all([
                request("options"),
                request("status", { mode: "article" }),
                request("history", { mode: "article" })
            ]);
            byId("worker-notice").hidden = results[0].online === true;
            renderJob(results[1].job || null);
            renderHistory(results[2].items || []);
            setStatus(translate("kindlearticles.ready", "Ready"));
        } catch (error) {
            showError(error);
            setStatus(translate("kindlearticles.error_connection", "Could not reach Article to Kindle."));
        }
    }

    async function submitJob(event) {
        event.preventDefault();
        var value = byId("article-url").value.trim();
        var url;
        try { url = new URL(value); } catch (error) { url = null; }
        if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
            showError({ message: translate("kindlearticles.error_url", "Enter a complete HTTP or HTTPS article URL.") });
            return;
        }
        setBusy(true);
        setStatus(translate("kindlearticles.submitting", "Submitting..."));
        try {
            var result = await request("create", { mode: "article", url: url.toString() });
            renderJob(result.job);
            await loadHistory();
            setStatus(result.existing
                ? translate("kindlearticles.existing", "An unfinished Kindle job is already active.")
                : translate("kindlearticles.queued", "Article queued."));
        } catch (error) {
            showError(error);
            setStatus(translate("kindlearticles.submit_failed", "Article was not queued."));
        } finally { setBusy(false); }
    }

    async function refreshJob() {
        if (!signedIn) return;
        try {
            var result = await request("status", currentJob ? { id: currentJob.id } : { mode: "article" });
            renderJob(result.job || null);
            if (terminal(currentJob)) await loadHistory();
            setStatus(translate("kindlearticles.updated", "Updated"));
        } catch (error) { showError(error); }
    }

    async function loadHistory() {
        var result = await request("history", { mode: "article" });
        renderHistory(result.items || []);
    }

    function renderJob(job) {
        currentJob = job;
        byId("job-panel").hidden = !job;
        if (!job) return stopPolling();

        var processing = processingState(job);
        var delivery = deliveryState(job);
        setStatusValue(byId("processing-state"), processing.icon, processing.text);
        setText(byId("processing-detail"), job.message || job.sourceLabel || "");
        setStatusValue(byId("delivery-state"), delivery.icon, delivery.text);
        setText(byId("delivery-detail"), resultText(job));

        var action = byId("job-action-button");
        action.hidden = false;
        if (job.state === "queued" || job.state === "running") {
            setText(action, translate("kindlearticles.cancel", "Cancel"));
            action.onclick = cancelJob;
        } else if (job.state === "failed" || job.state === "canceled") {
            setText(action, translate("kindlearticles.retry", "Retry"));
            action.onclick = retryJob;
        } else {
            action.hidden = true;
            action.onclick = null;
        }
        if (terminal(job)) stopPolling(); else startPolling();
    }

    function processingState(job) {
        if (job.state === "failed") return { icon: "failed", text: translate("kindlearticles.failed", "Failed") };
        if (job.state === "canceled") return { icon: "canceled", text: translate("kindlearticles.canceled", "Canceled") };
        if (job.phase === "queued") return { icon: "waiting", text: translate("kindlearticles.waiting", "Waiting") };
        if (job.phase === "collecting") return { icon: "extracting", text: translate("kindlearticles.extracting", "Extracting article") };
        if (job.phase === "building") return { icon: "building", text: translate("kindlearticles.building", "Building EPUB") };
        return { icon: "sent", text: translate("kindlearticles.complete", "Complete") };
    }

    function deliveryState(job) {
        if (job.phase === "sending") return { icon: "sending", text: translate("kindlearticles.sending", "Sending") };
        if (job.state === "sent") return { icon: "sent", text: translate("kindlearticles.sent", "Sent") };
        if (job.state === "failed") return { icon: "failed", text: translate("kindlearticles.not_sent", "Not sent") };
        if (job.state === "canceled") return { icon: "canceled", text: translate("kindlearticles.not_sent", "Not sent") };
        return { icon: "waiting", text: translate("kindlearticles.waiting", "Waiting") };
    }

    function resultText(job) {
        if (job.error) return job.error;
        if (!job.result) return "";
        return String(job.result.fileCount || 1) + " EPUB, " + formatBytes(job.result.sizeBytes || 0);
    }

    function formatBytes(value) {
        var bytes = Number(value || 0);
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function renderHistory(items) {
        var panel = byId("history-panel");
        var list = byId("history-list");
        panel.hidden = !items.length;
        list.innerHTML = "";
        items.forEach(function (job) {
            var row = document.createElement("div");
            var name = document.createElement("span");
            var state = document.createElement("span");
            row.className = "history-item";
            name.className = "history-name";
            state.className = "history-state";
            setText(name, job.sourceLabel || translate("kindlearticles.article", "Article"));
            var info = stateInfo(job.state);
            setStatusValue(state, info.icon, info.text);
            row.appendChild(name);
            row.appendChild(state);
            list.appendChild(row);
        });
    }

    function stateInfo(state) {
        var labels = {
            queued: { icon: "waiting", text: translate("kindlearticles.waiting", "Waiting") },
            running: { icon: "running", text: translate("kindlearticles.running", "Running") },
            sent: { icon: "sent", text: translate("kindlearticles.sent", "Sent") },
            failed: { icon: "failed", text: translate("kindlearticles.failed", "Failed") },
            canceled: { icon: "canceled", text: translate("kindlearticles.canceled", "Canceled") }
        };
        return labels[state] || { icon: "waiting", text: state };
    }

    async function cancelJob() {
        if (!currentJob) return;
        try {
            renderJob((await request("cancel", { id: currentJob.id })).job);
            setStatus(translate("kindlearticles.cancel_requested", "Cancellation requested."));
        } catch (error) { showError(error); }
    }

    async function retryJob() {
        if (!currentJob) return;
        try {
            renderJob((await request("retry", { id: currentJob.id })).job);
            setStatus(translate("kindlearticles.queued", "Article queued."));
        } catch (error) { showError(error); }
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(function () { if (!document.hidden) refreshJob(); }, 10000);
    }

    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    byId("article-form").addEventListener("submit", submitJob);
    byId("refresh-button").addEventListener("click", refreshJob);
    byId("error-close").addEventListener("click", function () { byId("error-modal").style.display = "none"; });
    if (window.rekindleI18nReady) initializeFirebase();
    else document.addEventListener("rekindle:i18n:ready", initializeFirebase);
}());
