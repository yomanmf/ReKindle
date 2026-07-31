(function () {
    "use strict";

    var API_PATH = "/manga-kindle/";
    var currentJob = null;
    var selectedSeries = null;
    var signedIn = false;
    var pollTimer = null;
    var STATUS_ICONS = {
        waiting: '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2"></path>',
        building: '<path d="M4 7h16v13H4zM4 11h16M8 4v6M16 4v6"></path>',
        sending: '<path d="M3 11L21 3l-7 18-3-7-8-3zM11 14L21 3"></path>',
        auth: '<circle cx="8" cy="12" r="4"></circle><path d="M12 12h9M17 12v3M20 12v3"></path>',
        complete: '<circle cx="12" cy="12" r="9"></circle><path d="M7 12l3 3 7-7"></path>',
        failed: '<circle cx="12" cy="12" r="9"></circle><path d="M8 8l8 8M16 8l-8 8"></path>',
        cancelled: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8zM8 12h8"></path>'
    };

    function byId(id) { return document.getElementById(id); }
    function translate(key, fallback) { return typeof window.t === "function" ? window.t(key, fallback) : fallback; }
    function setText(element, value) { if (element) element.textContent = value === undefined || value === null ? "" : String(value); }
    function setStatusValue(element, info) {
        element.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true">' + (STATUS_ICONS[info.icon] || STATUS_ICONS.waiting) + '</svg><span></span>';
        setText(element.lastChild, info.text);
    }
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
        byId("search-form").hidden = true;
        byId("send-form").hidden = true;
        setStatus(translate("mangakindle.signin", "Sign in to ReKindle before sending manga."));
    }

    async function loadAll() {
        setStatus(translate("mangakindle.loading", "Loading Manga to Kindle..."));
        try {
            var result = await request("status");
            renderJob(result.job || null);
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
        byId("search-results").hidden = true;
        try {
            selectedSeries = await request("series", { url: item.url });
            setText(byId("series-title"), selectedSeries.title);
            setText(byId("series-detail"), String(selectedSeries.chapterCount || 0) + " " + translate("mangakindle.chapters", "chapters") + ": " + selectedSeries.firstChapter + " - " + selectedSeries.lastChapter);
            byId("send-form").hidden = false;
            setStatus(translate("mangakindle.ready", "Ready"));
        } catch (error) {
            byId("search-results").hidden = false;
            showError(error);
        }
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
        setStatusValue(byId("job-state"), stateInfo(job.status));
        setText(byId("job-progress"), job.title + "\n" + (job.progress || ""));
        setStatusValue(byId("delivery-state"), deliveryInfo(job));
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

    function stateInfo(state) {
        var labels = {
            queued: { icon: "waiting", text: translate("mangakindle.waiting", "Waiting") },
            resume_pending: { icon: "waiting", text: translate("mangakindle.waiting", "Waiting") },
            processing: { icon: "building", text: translate("mangakindle.processing_now", "Building EPUB") },
            delivering: { icon: "sending", text: translate("mangakindle.sending", "Sending") },
            waiting_auth: { icon: "auth", text: translate("mangakindle.waiting", "Waiting") },
            completed: { icon: "complete", text: translate("mangakindle.complete", "Complete") },
            failed: { icon: "failed", text: translate("mangakindle.failed", "Failed") },
            cancelled: { icon: "cancelled", text: translate("mangakindle.cancelled", "Cancelled") }
        };
        return labels[state] || { icon: "waiting", text: state };
    }

    function deliveryInfo(job) {
        if (job.status === "completed") return { icon: "complete", text: translate("mangakindle.sent", "Sent") };
        if (job.status === "waiting_auth") return { icon: "auth", text: translate("mangakindle.waiting", "Waiting") };
        if (job.status === "delivering") return { icon: "sending", text: translate("mangakindle.sending", "Sending") };
        return { icon: "waiting", text: translate("mangakindle.waiting", "Waiting") };
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
    byId("error-close").addEventListener("click", closeError);
    initializeFirebase();
}());
