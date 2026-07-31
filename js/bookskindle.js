(function () {
    "use strict";

    var API_PATH = "/books-kindle/";
    var currentJob = null;
    var signedIn = false;
    var pollTimer = null;

    function byId(id) { return document.getElementById(id); }
    function translate(key, fallback) { return typeof window.t === "function" ? window.t(key, fallback) : fallback; }
    function setText(element, value) { if (element) element.textContent = value === undefined || value === null ? "" : String(value); }
    function request(action, body) { return window.RekindleCloud.request(API_PATH + action, { method: "POST", body: body || {} }); }
    function terminal(job) { return job && ["ready", "sent", "failed", "canceled"].indexOf(job.state) !== -1; }

    function setStatus(value) { setText(byId("status-bar"), value); }
    function showError(error) {
        setText(byId("error-message"), error && error.message || translate("bookskindle.error_connection", "Could not reach Books to Kindle."));
        byId("error-modal").style.display = "flex";
    }
    function closeError() { byId("error-modal").style.display = "none"; }

    function initializeFirebase() {
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) return showSignedOut();
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleBooksKindleFirebaseConfig);
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
        byId("results-panel").hidden = true;
        byId("job-panel").hidden = true;
        setStatus(translate("bookskindle.signin", "Sign in to ReKindle before sending books."));
    }

    async function loadAll() {
        setStatus(translate("bookskindle.loading", "Loading Books to Kindle..."));
        try {
            var results = await Promise.all([request("status"), request("kindle-status")]);
            renderJob(results[0].job || null);
            renderKindle(results[1]);
            setStatus(translate("bookskindle.ready", "Ready"));
        } catch (error) {
            showError(error);
            setStatus(translate("bookskindle.error_connection", "Could not reach Books to Kindle."));
        }
    }

    async function saveKindle() {
        try {
            renderKindle(await request("kindle-set", { email: byId("kindle-email").value.trim() }));
            setStatus(translate("bookskindle.saved", "Kindle address saved."));
        } catch (error) { showError(error); }
    }

    async function forgetKindle() {
        try {
            renderKindle(await request("kindle-forget"));
            setStatus(translate("bookskindle.forgotten", "Kindle address forgotten."));
        } catch (error) { showError(error); }
    }

    function renderKindle(result) {
        byId("kindle-email").value = result.email || "";
        byId("kindle-settings").hidden = result.connected === true;
        byId("kindle-change").hidden = result.connected !== true;
        setText(byId("kindle-state"), result.connected ? translate("bookskindle.connected", "Address saved") : translate("bookskindle.not_connected", "Address not saved"));
        var sender = result.sender ? translate("bookskindle.sender", "Approved sender") + ": " + result.sender : translate("bookskindle.sender_waiting", "Waiting for the delivery worker.");
        if (result.online !== true) sender += " " + translate("bookskindle.offline", "The worker is offline.");
        setText(byId("kindle-detail"), sender);
        byId("kindle-forget").disabled = result.connected !== true;
    }

    async function search(event) {
        event.preventDefault();
        var query = byId("query").value.trim();
        if (query.length < 2) return;
        byId("search-button").disabled = true;
        setStatus(translate("bookskindle.searching", "Searching..."));
        try {
            var result = await request("search", { query: query });
            renderJob(result.job);
            setStatus(result.existing ? translate("bookskindle.existing", "An unfinished job is already active.") : translate("bookskindle.queued", "Search queued."));
        } catch (error) { showError(error); }
        finally { byId("search-button").disabled = false; }
    }

    function renderJob(job) {
        currentJob = job;
        byId("job-panel").hidden = !job;
        if (!job) {
            byId("results-panel").hidden = true;
            return stopPolling();
        }
        setText(byId("job-state"), stateLabel(job.state));
        setText(byId("job-book"), job.selectedBook ? job.selectedBook.title : job.query);
        setText(byId("job-detail"), job.error || job.message || "");
        renderResults(job.state === "ready" ? job.results || [] : []);

        var action = byId("job-action");
        action.hidden = false;
        if (job.state === "queued" || job.state === "running") {
            setText(action, translate("bookskindle.cancel", "Cancel"));
            action.onclick = cancelJob;
        } else if (job.state === "failed" || job.state === "canceled") {
            setText(action, translate("bookskindle.retry", "Retry"));
            action.onclick = retryJob;
        } else {
            action.hidden = true;
            action.onclick = null;
        }
        if (terminal(job)) stopPolling(); else startPolling();
    }

    function renderResults(items) {
        var panel = byId("results-panel");
        var list = byId("search-results");
        list.innerHTML = "";
        panel.hidden = !items.length;
        items.forEach(function (book) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "sys-btn result-button";
            setText(button, book.title + "\n" + book.author + (book.formats.length ? " - " + book.formats.join(" / ") : ""));
            button.addEventListener("click", function () { sendBook(book.id); });
            list.appendChild(button);
        });
    }

    async function sendBook(bookId) {
        if (!currentJob) return;
        setStatus(translate("bookskindle.submitting", "Submitting..."));
        try {
            renderJob((await request("create", { id: currentJob.id, bookId: bookId })).job);
            setStatus(translate("bookskindle.queued", "Book queued."));
        } catch (error) { showError(error); }
    }

    async function refreshJob() {
        if (!signedIn) return;
        try {
            renderJob((await request("status", currentJob ? { id: currentJob.id } : {})).job || null);
            setStatus(translate("bookskindle.updated", "Updated"));
        } catch (error) { showError(error); }
    }

    async function cancelJob() {
        try { renderJob((await request("cancel", { id: currentJob.id })).job); }
        catch (error) { showError(error); }
    }

    async function retryJob() {
        try { renderJob((await request("retry", { id: currentJob.id })).job); }
        catch (error) { showError(error); }
    }

    function stateLabel(state) {
        var labels = {
            queued: translate("bookskindle.waiting", "Waiting"),
            running: translate("bookskindle.processing", "Processing"),
            ready: translate("bookskindle.choose", "Choose a book"),
            sent: translate("bookskindle.sent", "Sent"),
            failed: translate("bookskindle.failed", "Failed"),
            canceled: translate("bookskindle.canceled", "Canceled")
        };
        return labels[state] || state;
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(function () { if (!document.hidden) refreshJob(); }, 8000);
    }

    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    byId("kindle-save").addEventListener("click", saveKindle);
    byId("kindle-forget").addEventListener("click", forgetKindle);
    byId("kindle-change").addEventListener("click", function () {
        byId("kindle-settings").hidden = false;
        byId("kindle-change").hidden = true;
        byId("kindle-email").focus();
    });
    byId("search-form").addEventListener("submit", search);
    byId("job-refresh").addEventListener("click", refreshJob);
    byId("error-close").addEventListener("click", closeError);
    initializeFirebase();
}());
