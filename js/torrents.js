(function () {
    "use strict";

    var API_PATH = "/manga-kindle/";
    var pendingTorrent = null;
    var lastTorrents = [];
    var currentFilter = "all";

    function byId(id) { return document.getElementById(id); }
    function translate(key, fallback) { return typeof window.t === "function" ? window.t(key, fallback) : fallback; }
    function setText(element, value) { if (element) element.textContent = value === undefined || value === null ? "" : String(value); }
    function request(action, body) { return window.RekindleCloud.request(API_PATH + action, { method: "POST", body: body || {} }); }
    function setStatus(value) { setText(byId("status-bar"), value); }

    function initializeFirebase() {
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) return showSignedOut();
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleTorrentsFirebaseConfig);
            firebase.auth().onAuthStateChanged(function (user) {
                var signedIn = Boolean(user);
                byId("auth-notice").hidden = signedIn;
                byId("downloads-panel").hidden = !signedIn;
                if (signedIn) loadTorrents(); else showSignedOut();
            }, showSignedOut);
        } catch (error) { showSignedOut(); }
    }

    function showSignedOut() {
        byId("auth-notice").hidden = false;
        byId("downloads-panel").hidden = true;
        setStatus(translate("torrents.signin", "Sign in to ReKindle to manage downloads"));
    }

    async function loadTorrents() {
        var button = byId("refresh-button");
        button.disabled = true;
        setStatus(translate("torrents.loading", "Loading downloads..."));
        try {
            var result = await request("torrents");
            renderTorrents(result.torrents || []);
            setStatus(translate("torrents.updated", "Updated"));
            return true;
        } catch (error) {
            showError(error);
            setStatus(translate("torrents.error_connection", "Could not reach the download service"));
            return false;
        } finally {
            button.disabled = false;
        }
    }

    function renderTorrents(items) {
        lastTorrents = items;
        var visibleItems = currentFilter === "completed" ? items.filter(isCompleted) : items;
        var list = byId("torrent-list");
        list.innerHTML = "";
        var empty = byId("empty-state");
        var title = byId("downloads-title");
        var completed = currentFilter === "completed";
        empty.hidden = visibleItems.length !== 0;
        empty.setAttribute("data-i18n", completed ? "torrents.empty_completed" : "torrents.empty");
        setText(empty, translate(completed ? "torrents.empty_completed" : "torrents.empty", completed ? "No completed downloads" : "No torrent tasks"));
        title.setAttribute("data-i18n", completed ? "torrents.completed" : "torrents.all");
        setText(title, translate(completed ? "torrents.completed" : "torrents.all", completed ? "Completed downloads" : "All downloads"));
        setText(byId("torrent-count"), translate("torrents.count", "${count} tasks").replace("${count}", String(visibleItems.length)));
        visibleItems.forEach(function (torrent) { list.appendChild(torrentCard(torrent)); });
    }

    function isCompleted(torrent) { return Math.max(0, Number(torrent.progress) || 0) >= 1; }

    function setFilter(value) {
        currentFilter = value;
        ["all", "completed"].forEach(function (name) {
            var active = name === value;
            var button = byId("filter-" + name);
            button.className = "sys-btn" + (active ? " primary" : "");
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        renderTorrents(lastTorrents);
    }

    function torrentCard(torrent) {
        var card = document.createElement("article");
        card.className = "torrent-card";

        var header = document.createElement("div");
        header.className = "torrent-header";
        var name = document.createElement("h2");
        name.className = "torrent-name";
        setText(name, torrent.name);
        var state = document.createElement("span");
        state.className = "torrent-state";
        var stateLabel = torrentState(torrent);
        state.setAttribute("data-i18n", stateLabel.key);
        setText(state, translate(stateLabel.key, stateLabel.fallback));
        header.appendChild(name);
        header.appendChild(state);
        card.appendChild(header);

        var details = document.createElement("div");
        details.className = "torrent-details";
        if (torrent.source === "seerr") {
            details.appendChild(metric("torrents.source", "Source", "Seerr"));
            details.appendChild(metric("torrents.media_type", "Media type", translate(
                torrent.mediaType === "tv" ? "torrents.media_series" : "torrents.media_movie",
                torrent.mediaType === "tv" ? "Series" : "Movie"
            )));
        } else {
            var percent = Math.round(Math.max(0, Math.min(1, Number(torrent.progress) || 0)) * 100);
            var track = document.createElement("div");
            track.className = "progress-track";
            track.setAttribute("role", "progressbar");
            track.setAttribute("aria-valuemin", "0");
            track.setAttribute("aria-valuemax", "100");
            track.setAttribute("aria-valuenow", String(percent));
            var fill = document.createElement("span");
            fill.className = "progress-fill";
            fill.style.width = percent + "%";
            track.appendChild(fill);
            card.appendChild(track);
            var progressText = document.createElement("span");
            progressText.className = "progress-text";
            setText(progressText, percent + "% - " + formatBytes(torrent.completed) + " / " + formatBytes(torrent.size));
            card.appendChild(progressText);
            details.appendChild(metric("torrents.download_speed", "Download", formatSpeed(torrent.downloadSpeed)));
            details.appendChild(metric("torrents.upload_speed", "Upload", formatSpeed(torrent.uploadSpeed)));
            details.appendChild(metric("torrents.eta", "ETA", formatEta(torrent.eta)));
        }
        card.appendChild(details);

        if (torrent.source !== "seerr") {
            var actions = document.createElement("div");
            actions.className = "torrent-actions";
            var paused = isPaused(torrent);
            var pauseButton = document.createElement("button");
            pauseButton.type = "button";
            pauseButton.className = "sys-btn";
            pauseButton.setAttribute("data-i18n", paused ? "torrents.resume" : "torrents.pause");
            setText(pauseButton, translate(paused ? "torrents.resume" : "torrents.pause", paused ? "Resume" : "Pause"));
            pauseButton.addEventListener("click", function () { setPaused(torrent, paused, pauseButton); });
            actions.appendChild(pauseButton);
        }
        var deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "sys-btn delete-button";
        deleteButton.setAttribute("data-i18n", "torrents.delete");
        setText(deleteButton, translate("torrents.delete", "Delete"));
        deleteButton.addEventListener("click", function () { openDelete(torrent); });
        if (actions) {
            actions.appendChild(deleteButton);
            card.appendChild(actions);
        } else {
            card.appendChild(deleteButton);
        }
        return card;
    }

    function isPaused(torrent) { return /^(paused|stopped)/i.test(String(torrent.state || "")); }

    async function setPaused(torrent, paused, button) {
        button.disabled = true;
        setStatus(translate(paused ? "torrents.resuming" : "torrents.pausing", paused ? "Resuming download..." : "Pausing download..."));
        try {
            await request(paused ? "torrent-resume" : "torrent-pause", { hash: torrent.hash });
            if (await loadTorrents()) {
                setStatus(translate(paused ? "torrents.resumed" : "torrents.paused", paused ? "Download resumed" : "Download paused"));
            }
        } catch (error) { showError(error); }
        finally { button.disabled = false; }
    }

    function metric(key, fallback, value) {
        var box = document.createElement("div");
        box.className = "metric";
        var label = document.createElement("span");
        label.className = "metric-label";
        label.setAttribute("data-i18n", key);
        setText(label, translate(key, fallback));
        var content = document.createElement("span");
        setText(content, value);
        box.appendChild(label);
        box.appendChild(content);
        return box;
    }

    function torrentState(torrent) {
        var state = String(torrent.state || "").toLowerCase();
        if (isCompleted(torrent)) return { key: "torrents.state_completed", fallback: "Completed" };
        if (state.indexOf("error") !== -1 || state.indexOf("missing") !== -1) return { key: "torrents.state_error", fallback: "Error" };
        if (state.indexOf("paused") !== -1 || state.indexOf("stopped") !== -1) return { key: "torrents.state_paused", fallback: "Paused" };
        if (state.indexOf("check") !== -1 || state.indexOf("moving") !== -1 || state.indexOf("allocating") !== -1) return { key: "torrents.state_checking", fallback: "Checking" };
        if (state.indexOf("meta") !== -1) return { key: "torrents.state_metadata", fallback: "Metadata" };
        if (state.indexOf("queued") !== -1) return { key: "torrents.state_queued", fallback: "Queued" };
        if (state.indexOf("upload") !== -1 || state.indexOf("seed") !== -1 || state.indexOf("stalledup") !== -1 || state.indexOf("forcedup") !== -1) return { key: "torrents.state_seeding", fallback: "Seeding" };
        if (state.indexOf("download") !== -1 || state.indexOf("stalleddl") !== -1 || state.indexOf("forceddl") !== -1) return { key: "torrents.state_downloading", fallback: "Downloading" };
        return { key: "torrents.state_unknown", fallback: "Unknown" };
    }

    function formatBytes(value) {
        var bytes = Math.max(0, Number(value) || 0);
        var units = ["B", "KB", "MB", "GB", "TB"];
        var index = 0;
        while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index += 1; }
        return (index === 0 ? String(Math.round(bytes)) : bytes.toFixed(bytes >= 10 ? 1 : 2)) + " " + units[index];
    }

    function formatSpeed(value) { return formatBytes(value) + "/s"; }

    function formatEta(value) {
        var seconds = Math.max(0, Math.floor(Number(value) || 0));
        if (!seconds || seconds >= 8640000) return "--";
        var days = Math.floor(seconds / 86400);
        var hours = Math.floor((seconds % 86400) / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        if (days) return days + "d " + hours + "h";
        if (hours) return hours + "h " + minutes + "m";
        if (minutes) return minutes + "m";
        return seconds + "s";
    }

    function openDelete(torrent) {
        pendingTorrent = torrent;
        var template = torrent.source === "seerr"
            ? translate("torrents.delete_media_message", "Delete ${name} from the media library with all files? A series is deleted in full. This cannot be undone")
            : translate("torrents.delete_message", "Delete ${name} and all downloaded files? This cannot be undone");
        setText(byId("delete-message"), template.replace("${name}", torrent.name));
        byId("delete-modal").style.display = "flex";
        byId("delete-cancel").focus();
    }

    function closeDelete() {
        pendingTorrent = null;
        byId("delete-modal").style.display = "none";
    }

    async function confirmDelete() {
        if (!pendingTorrent) return;
        var torrent = pendingTorrent;
        var button = byId("delete-confirm");
        button.disabled = true;
        setStatus(translate("torrents.deleting", "Deleting task and files..."));
        try {
            if (torrent.source === "seerr") {
                await request("media-delete", { requestId: torrent.requestId, mediaId: torrent.mediaId });
            } else {
                await request("torrent-delete", { hash: torrent.hash });
            }
            closeDelete();
            await loadTorrents();
            setStatus(translate("torrents.deleted", "Task and downloaded files deleted"));
        } catch (error) { showError(error); }
        finally { button.disabled = false; }
    }

    function showError() {
        setText(byId("error-message"), translate("torrents.error_connection", "Could not reach the download service"));
        byId("error-modal").style.display = "flex";
    }

    function closeError() { byId("error-modal").style.display = "none"; }

    byId("refresh-button").addEventListener("click", loadTorrents);
    byId("filter-all").addEventListener("click", function () { setFilter("all"); });
    byId("filter-completed").addEventListener("click", function () { setFilter("completed"); });
    byId("delete-cancel").addEventListener("click", closeDelete);
    byId("delete-confirm").addEventListener("click", confirmDelete);
    byId("error-close").addEventListener("click", closeError);
    document.addEventListener("rekindle:i18n:ready", function () { renderTorrents(lastTorrents); });
    initializeFirebase();
}());
