(function () {
    "use strict";

    var API_PATH = "/kindle-digest/";
    var currentJob = null;
    var signedIn = false;
    var pollTimer = null;

    function byId(id) { return document.getElementById(id); }
    function translate(key, fallback) { return typeof window.t === "function" ? window.t(key, fallback) : fallback; }
    function setText(element, value) { if (element) element.textContent = value === undefined || value === null ? "" : String(value); }
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
        setText(byId("collection-state"), collection);
        setText(byId("delivery-state"), delivery);
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
        if (job.state === "failed") return translate("kindledigest.failed", "Failed");
        if (job.state === "canceled") return translate("kindledigest.canceled", "Canceled");
        if (job.phase === "queued") return translate("kindledigest.waiting", "Waiting");
        if (job.phase === "collecting") return translate("kindledigest.collecting", "Collecting");
        if (job.phase === "building") return translate("kindledigest.building", "Building file");
        return translate("kindledigest.complete", "Complete");
    }

    function deliveryState(job) {
        if (job.phase === "sending") return translate("kindledigest.sending", "Sending");
        if (job.state === "sent") return translate("kindledigest.sent", "Sent");
        if (job.state === "failed" || job.state === "canceled") return translate("kindledigest.not_sent", "Not sent");
        return translate("kindledigest.waiting", "Waiting");
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
            setText(state, stateLabel(job.state));
            row.appendChild(name);
            row.appendChild(state);
            list.appendChild(row);
        });
    }

    function stateLabel(state) {
        var labels = {
            queued: translate("kindledigest.waiting", "Waiting"),
            running: translate("kindledigest.running", "Running"),
            sent: translate("kindledigest.sent", "Sent"),
            failed: translate("kindledigest.failed", "Failed"),
            canceled: translate("kindledigest.canceled", "Canceled")
        };
        return labels[state] || state;
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
