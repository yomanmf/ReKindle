(function () {
    "use strict";

    var API_PATH = "/manga-kindle/";
    var currentJob = null;
    var selectedSeries = null;
    var signedIn = false;
    var pollTimer = null;

    function byId(id) { return document.getElementById(id); }
    function translate(key, fallback) { return typeof window.t === "function" ? window.t(key, fallback) : fallback; }
    function setText(element, value) { if (element) element.textContent = value === undefined || value === null ? "" : String(value); }
    function request(action, body) { return window.RekindleCloud.request(API_PATH + action, { method: "POST", body: body || {} }); }
    function terminal(job) { return job && ["completed", "failed", "cancelled"].indexOf(job.status) !== -1; }

    function setStatus(value) { setText(byId("status-bar"), value); }
    function showError(error) {
        setText(byId("error-message"), error && error.message || translate("mangakindle.error_connection", "Could not reach Manga to Kindle."));
        byId("error-modal").style.display = "flex";
    }
    function closeError() { byId("error-modal").style.display = "none"; }

    function initializeFirebase() {
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) return showSignedOut();
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleMangaKindleFirebaseConfig);
            firebase.auth().onAuthStateChanged(function (user) {
                signedIn = Boolean(user);
                byId("auth-notice").hidden = signedIn;
                byId("kindle-panel").hidden = !signedIn;
                byId("search-form").hidden = !signedIn;
                if (!signedIn) return showSignedOut();
                loadAll();
            }, showSignedOut);
        } catch (error) { showSignedOut(); }
    }

    function showSignedOut() {
        signedIn = false;
        stopPolling();
        byId("auth-notice").hidden = false;
        byId("kindle-panel").hidden = true;
        byId("search-form").hidden = true;
        byId("send-form").hidden = true;
        setStatus(translate("mangakindle.signin", "Sign in to ReKindle before sending manga."));
    }

    async function loadAll() {
        setStatus(translate("mangakindle.loading", "Loading Manga to Kindle..."));
        try {
            var results = await Promise.all([request("status"), request("kindle-status")]);
            renderJob(results[0].job || null);
            renderKindle(results[1]);
            setStatus(translate("mangakindle.ready", "Ready"));
        } catch (error) {
            showError(error);
            setStatus(translate("mangakindle.error_connection", "Could not reach Manga to Kindle."));
        }
    }

    async function search(event) {
        event.preventDefault();
        var query = byId("query").value.trim();
        if (query.length < 2) return;
        byId("search-button").disabled = true;
        setStatus(translate("mangakindle.searching", "Searching..."));
        try {
            var result = await request("search", { query: query });
            renderResults(result.results || []);
            setStatus((result.results || []).length ? translate("mangakindle.choose", "Choose a title.") : translate("mangakindle.not_found", "Nothing found."));
        } catch (error) { showError(error); }
        finally { byId("search-button").disabled = false; }
    }

    function renderResults(items) {
        var list = byId("search-results");
        list.innerHTML = "";
        list.hidden = !items.length;
        items.forEach(function (item) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "sys-btn result-button";
            setText(button, item.title);
            button.addEventListener("click", function () { selectSeries(item); });
            list.appendChild(button);
        });
    }

    async function selectSeries(item) {
        setStatus(translate("mangakindle.loading_chapters", "Loading chapters..."));
        try {
            selectedSeries = await request("series", { url: item.url });
            setText(byId("series-title"), selectedSeries.title);
            setText(byId("series-detail"), String(selectedSeries.chapterCount || 0) + " " + translate("mangakindle.chapters", "chapters") + ": " + selectedSeries.firstChapter + " - " + selectedSeries.lastChapter);
            byId("send-form").hidden = false;
            setStatus(translate("mangakindle.ready", "Ready"));
        } catch (error) { showError(error); }
    }

    async function createJob(event) {
        event.preventDefault();
        if (!selectedSeries) return;
        var from = boundary(byId("from-chapter").value, "first");
        var to = boundary(byId("to-chapter").value, "latest");
        if (!from || !to || (from !== "first" && to !== "latest" && Number(from) > Number(to))) {
            showError({ message: translate("mangakindle.error_range", "Enter a valid chapter range.") });
            return;
        }
        byId("send-button").disabled = true;
        setStatus(translate("mangakindle.submitting", "Submitting..."));
        try {
            var result = await request("create", {
                title: selectedSeries.title,
                url: selectedSeries.url,
                fromChapter: from,
                toChapter: to,
                mergeVerticalPages: byId("merge-pages").checked
            });
            renderJob(result.job);
            setStatus(result.existing ? translate("mangakindle.existing", "An unfinished job is already active.") : translate("mangakindle.queued", "Manga queued."));
        } catch (error) { showError(error); }
        finally { byId("send-button").disabled = false; }
    }

    function boundary(value, fallback) {
        var result = String(value || fallback).trim().toLowerCase().replace(",", ".");
        return result === fallback || /^\d+(?:\.\d+)?$/.test(result) ? result : "";
    }

    async function refreshJob() {
        if (!signedIn) return;
        try {
            var result = await request("status", currentJob ? { id: currentJob.id } : {});
            renderJob(result.job || null);
            setStatus(translate("mangakindle.updated", "Updated"));
        } catch (error) { showError(error); }
    }

    function renderJob(job) {
        currentJob = job;
        byId("job-panel").hidden = !job;
        if (!job) return stopPolling();
        setText(byId("job-state"), stateLabel(job.status));
        setText(byId("job-progress"), job.title + "\n" + (job.progress || ""));
        setText(byId("delivery-state"), deliveryLabel(job));
        setText(byId("job-files"), fileText(job.files || [], job.error));

        var action = byId("job-action");
        action.hidden = false;
        if (["queued", "resume_pending", "processing", "waiting_auth"].indexOf(job.status) !== -1) {
            setText(action, translate("mangakindle.cancel", "Cancel"));
            action.onclick = cancelJob;
        } else if (["failed", "cancelled"].indexOf(job.status) !== -1) {
            setText(action, translate("mangakindle.retry", "Retry"));
            action.onclick = retryJob;
        } else {
            action.hidden = true;
            action.onclick = null;
        }
        if (terminal(job)) stopPolling(); else startPolling();
    }

    function stateLabel(state) {
        var labels = {
            queued: translate("mangakindle.waiting", "Waiting"),
            resume_pending: translate("mangakindle.waiting", "Waiting"),
            processing: translate("mangakindle.processing_now", "Building EPUB"),
            delivering: translate("mangakindle.sending", "Sending"),
            waiting_auth: translate("mangakindle.needs_auth", "Amazon sign-in needed"),
            completed: translate("mangakindle.complete", "Complete"),
            failed: translate("mangakindle.failed", "Failed"),
            cancelled: translate("mangakindle.cancelled", "Cancelled")
        };
        return labels[state] || state;
    }

    function deliveryLabel(job) {
        if (job.status === "completed") return translate("mangakindle.sent", "Sent");
        if (job.status === "waiting_auth") return translate("mangakindle.needs_auth", "Amazon sign-in needed");
        if (job.status === "delivering") return translate("mangakindle.sending", "Sending");
        return translate("mangakindle.waiting", "Waiting");
    }

    function fileText(files, error) {
        if (error) return error;
        if (!files.length) return translate("mangakindle.no_files", "No files yet.");
        return files.map(function (file) { return file.filename + " - " + file.status; }).join("\n");
    }

    async function cancelJob() {
        try { renderJob((await request("cancel")).job); }
        catch (error) { showError(error); }
    }

    async function retryJob() {
        try { renderJob((await request("retry")).job); }
        catch (error) { showError(error); }
    }

    async function refreshKindle() {
        try { renderKindle(await request("kindle-status")); }
        catch (error) { showError(error); }
    }

    function renderKindle(result) {
        setText(byId("kindle-state"), result.connected ? translate("mangakindle.connected", "Connected") : translate("mangakindle.not_connected", "Not connected"));
        byId("kindle-connect").hidden = result.connected === true;
    }

    async function connectKindle() {
        try {
            setStatus(translate("mangakindle.opening_amazon", "Opening Amazon sign-in..."));
            var result = await request("kindle-connect");
            window.location.href = result.url;
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

    byId("search-form").addEventListener("submit", search);
    byId("send-form").addEventListener("submit", createJob);
    byId("job-refresh").addEventListener("click", refreshJob);
    byId("kindle-refresh").addEventListener("click", refreshKindle);
    byId("kindle-connect").addEventListener("click", connectKindle);
    byId("error-close").addEventListener("click", closeError);
    initializeFirebase();
}());
