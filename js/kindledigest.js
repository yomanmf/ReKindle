(function () {
    "use strict";

    var API_PATH = "/kindle-digest/";
    var currentJob = null;
    var signedIn = false;
    var pollTimer = null;
    var STATUS_ICONS = {
        waiting: '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2"></path>',
        collecting: '<circle cx="9" cy="10" r="5"></circle><path d="M13 14l6 6M7 8h4M7 11h3"></path>',
        building: '<path d="M4 7h16v13H4zM4 11h16M8 4v6M16 4v6"></path>',
        complete: '<circle cx="12" cy="12" r="9"></circle><path d="M7 12l3 3 7-7"></path>',
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
    function selected(name) { var item = document.querySelector('input[name="' + name + '"]:checked'); return item ? item.value : ""; }
    function terminal(job) { return job && (job.state === "sent" || job.state === "failed" || job.state === "canceled"); }

    function request(action, body) {
        return window.RekindleCloud.request(API_PATH + action, { method: "POST", body: body || {} });
    }

    function setStatus(value) { setText(byId("status-bar"), value); }

    function showError(error) {
        setText(byId("error-message"), error && error.message || translate("kindledigest.error_connection", "Could not reach the Kindle Digest service."));
        byId("error-modal").style.display = "flex";
    }

    function closeError() { byId("error-modal").style.display = "none"; }

    function setBusy(busy) {
        var button = byId("submit-button");
        button.disabled = busy || !signedIn;
        setText(button, busy ? translate("kindledigest.submitting", "Submitting...") : translate("kindledigest.submit", "Collect and send"));
    }

    function initializeFirebase() {
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) {
            showSignedOut();
            return;
        }
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleKindleDigestFirebaseConfig);
            firebase.auth().onAuthStateChanged(function (user) {
                signedIn = Boolean(user);
                byId("auth-notice").hidden = signedIn;
                byId("digest-form").hidden = !signedIn;
                setBusy(false);
                if (!signedIn) {
                    stopPolling();
                    setStatus(translate("kindledigest.signin", "Sign in to ReKindle before creating a digest."));
                    return;
                }
                loadAll();
            }, showSignedOut);
        } catch (error) { showSignedOut(); }
    }

    function showSignedOut() {
        signedIn = false;
        byId("auth-notice").hidden = false;
        byId("digest-form").hidden = true;
        setStatus(translate("kindledigest.signin", "Sign in to ReKindle before creating a digest."));
    }

    async function loadAll() {
        setStatus(translate("kindledigest.loading", "Loading Kindle Digest..."));
        try {
            var results = await Promise.all([request("options"), request("status"), request("history")]);
            renderOptions(results[0]);
            renderJob(results[1].job || null);
            renderHistory(results[2].items || []);
            setStatus(translate("kindledigest.ready", "Ready"));
        } catch (error) {
            showError(error);
            setStatus(translate("kindledigest.error_connection", "Could not reach the Kindle Digest service."));
        }
    }

    function renderOptions(result) {
        var select = byId("source-select");
        var previous = select.value;
        select.innerHTML = "";
        (result.sources || []).forEach(function (source) {
            var option = document.createElement("option");
            option.value = source.id;
            setText(option, source.label);
            select.appendChild(option);
        });
        var custom = document.createElement("option");
        custom.value = "custom";
        setText(custom, translate("kindledigest.custom", "Custom site"));
        select.appendChild(custom);
        if (previous) select.value = previous;
        byId("worker-notice").hidden = result.online === true;
        updateSourceVisibility();
    }

    function updateSourceVisibility() {
        var daily = selected("mode") === "daily";
        byId("source-field").hidden = !daily;
        byId("custom-field").hidden = !daily || byId("source-select").value !== "custom";
    }

    async function submitJob(event) {
        event.preventDefault();
        var days = Number(byId("lookback-days").value);
        if (!Number.isInteger(days) || days < 1 || days > 30) {
            showError({ message: translate("kindledigest.error_days", "Recent days must be from 1 to 30.") });
            return;
        }
        var mode = selected("mode");
        var sourceId = mode === "daily" ? byId("source-select").value : "";
        var customUrl = byId("custom-url").value.trim();
        if (mode === "daily" && sourceId === "custom" && !/^https?:\/\//i.test(customUrl)) {
            showError({ message: translate("kindledigest.error_url", "Enter a complete HTTP or HTTPS source URL.") });
            return;
        }
        setBusy(true);
        setStatus(translate("kindledigest.submitting", "Submitting..."));
        try {
            var limit = byId("article-limit").value;
            var result = await request("create", {
                mode: mode,
                sourceId: sourceId,
                sourceUrl: customUrl,
                lookbackDays: days,
                filter: selected("filter"),
                articleLimit: limit ? Number(limit) : null
            });
            renderJob(result.job);
            await loadHistory();
            setStatus(result.existing
                ? translate("kindledigest.existing", "An unfinished job is already active.")
                : translate("kindledigest.queued", "Digest queued."));
        } catch (error) {
            showError(error);
            setStatus(translate("kindledigest.submit_failed", "Digest was not queued."));
        } finally { setBusy(false); }
    }

    async function refreshJob() {
        if (!signedIn) return;
        try {
            var result = await request("status", currentJob ? { id: currentJob.id } : {});
            renderJob(result.job || null);
            if (terminal(currentJob)) await loadHistory();
            setStatus(translate("kindledigest.updated", "Updated"));
        } catch (error) { showError(error); }
    }

    async function loadHistory() {
        var result = await request("history");
        renderHistory(result.items || []);
    }

    function renderJob(job) {
        currentJob = job;
        byId("job-panel").hidden = !job;
        if (!job) { stopPolling(); return; }

        var collection = collectionState(job);
        var delivery = deliveryState(job);
        setStatusValue(byId("collection-state"), collection.icon, collection.text);
        setStatusValue(byId("delivery-state"), delivery.icon, delivery.text);
        setText(byId("collection-detail"), job.message || job.sourceLabel || "");
        setText(byId("delivery-detail"), resultText(job));

        var action = byId("job-action-button");
        action.hidden = false;
        if (job.state === "queued" || job.state === "running") {
            setText(action, translate("kindledigest.cancel", "Cancel"));
            action.onclick = cancelJob;
        } else if (job.state === "failed" || job.state === "canceled") {
            setText(action, translate("kindledigest.retry", "Retry"));
            action.onclick = retryJob;
        } else {
            action.hidden = true;
            action.onclick = null;
        }
        if (terminal(job)) stopPolling(); else startPolling();
    }

    function collectionState(job) {
        if (job.state === "failed") return { icon: "failed", text: translate("kindledigest.failed", "Failed") };
        if (job.state === "canceled") return { icon: "canceled", text: translate("kindledigest.canceled", "Canceled") };
        if (job.phase === "queued") return { icon: "waiting", text: translate("kindledigest.waiting", "Waiting") };
        if (job.phase === "collecting") return { icon: "collecting", text: translate("kindledigest.collecting", "Collecting") };
        if (job.phase === "building") return { icon: "building", text: translate("kindledigest.building", "Building file") };
        return { icon: "complete", text: translate("kindledigest.complete", "Complete") };
    }

    function deliveryState(job) {
        if (job.phase === "sending") return { icon: "sending", text: translate("kindledigest.sending", "Sending") };
        if (job.state === "sent") return { icon: "sent", text: translate("kindledigest.sent", "Sent") };
        if (job.state === "failed") return { icon: "failed", text: translate("kindledigest.not_sent", "Not sent") };
        if (job.state === "canceled") return { icon: "canceled", text: translate("kindledigest.not_sent", "Not sent") };
        return { icon: "waiting", text: translate("kindledigest.waiting", "Waiting") };
    }

    function resultText(job) {
        if (job.error) return job.error;
        if (!job.result) return "";
        return String(job.result.articleCount || 0) + " " + translate("kindledigest.articles", "articles") + ", " + formatBytes(job.result.sizeBytes || 0);
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
            row.className = "history-item";
            var name = document.createElement("span");
            name.className = "history-name";
            setText(name, job.mode === "digest" ? translate("kindledigest.mode_all", "All publications") : job.sourceLabel);
            var state = document.createElement("span");
            state.className = "history-state";
            var info = stateInfo(job.state);
            setStatusValue(state, info.icon, info.text);
            row.appendChild(name);
            row.appendChild(state);
            list.appendChild(row);
        });
    }

    function stateInfo(state) {
        var labels = {
            queued: { icon: "waiting", text: translate("kindledigest.waiting", "Waiting") },
            running: { icon: "running", text: translate("kindledigest.running", "Running") },
            sent: { icon: "sent", text: translate("kindledigest.sent", "Sent") },
            failed: { icon: "failed", text: translate("kindledigest.failed", "Failed") },
            canceled: { icon: "canceled", text: translate("kindledigest.canceled", "Canceled") }
        };
        return labels[state] || { icon: "waiting", text: state };
    }

    async function cancelJob() {
        if (!currentJob) return;
        try {
            var result = await request("cancel", { id: currentJob.id });
            renderJob(result.job);
            setStatus(translate("kindledigest.cancel_requested", "Cancellation requested."));
        } catch (error) { showError(error); }
    }

    async function retryJob() {
        if (!currentJob) return;
        try {
            var result = await request("retry", { id: currentJob.id });
            renderJob(result.job);
            setStatus(translate("kindledigest.queued", "Digest queued."));
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

    function bind() {
        byId("digest-form").addEventListener("submit", submitJob);
        byId("source-select").addEventListener("change", updateSourceVisibility);
        var modes = document.querySelectorAll('input[name="mode"]');
        for (var i = 0; i < modes.length; i++) modes[i].addEventListener("change", updateSourceVisibility);
        var presets = document.querySelectorAll(".day-preset");
        for (var j = 0; j < presets.length; j++) presets[j].addEventListener("click", function () { byId("lookback-days").value = this.getAttribute("data-days"); });
        byId("refresh-button").addEventListener("click", refreshJob);
        byId("error-close").addEventListener("click", closeError);
    }

    bind();
    initializeFirebase();
}());
