(function () {
    "use strict";

    var REQUEST_TIMEOUT_MS = 25000;
    var isDemo = window.location.search.indexOf("demo=1") !== -1;
    var authorized = false;
    var lists = [];
    var tasks = [];
    var currentList = null;
    var currentTask = null;
    var currentFilter = "all";
    var pollTimer = null;
    var expiresAt = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function translate(key, fallback) {
        if (typeof window.t === "function") return window.t(key, fallback);
        return fallback;
    }

    function template(key, fallback, values) {
        var result = translate(key, fallback);
        Object.keys(values || {}).forEach(function (name) {
            result = String(result).split("${" + name + "}").join(String(values[name]));
        });
        return result;
    }

    function setText(element, value) {
        if (element) element.textContent = value === undefined || value === null ? "" : String(value);
    }

    function setStatus(value) {
        setText(byId("status-bar"), value);
    }

    function setBusy(button, busy, busyText, normalText) {
        if (!button) return;
        button.disabled = busy;
        setText(button, busy ? busyText : normalText);
    }

    function showView(id) {
        var views = document.querySelectorAll(".view");
        for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
        var target = byId(id);
        if (target) target.classList.add("active");
    }

    function showStage(stage) {
        var stages = document.querySelectorAll(".auth-stage");
        for (var i = 0; i < stages.length; i++) stages[i].classList.remove("active");
        var target = byId("stage-" + stage);
        if (!target) target = byId("stage-start");
        if (target) target.classList.add("active");
    }

    function openModal(id) {
        var modal = byId(id);
        if (modal) modal.style.display = "flex";
    }

    function closeModal(id) {
        var modal = byId(id);
        if (modal) modal.style.display = "none";
    }

    function showError(error) {
        setText(byId("error-message"), describeError(error));
        openModal("error-modal");
    }

    function describeError(error) {
        var code = String(error && error.code || "");
        var messages = {
            "microsoft-todo-configuration": ["microsofttodo.error.configuration", "Microsoft To Do is not configured on the ReKindle server yet."],
            "microsoft-todo-auth-expired": ["microsofttodo.error.auth_expired", "The Microsoft sign-in code expired. Get a new code."],
            "microsoft-todo-auth-declined": ["microsofttodo.error.auth_declined", "Microsoft sign-in was cancelled."],
            "microsoft-todo-session-expired": ["microsofttodo.error.session_expired", "The Microsoft session expired. Connect again."],
            "microsoft-todo-not-connected": ["microsofttodo.error.session_expired", "Connect Microsoft To Do first."],
            "microsoft-todo-rate-limited": ["microsofttodo.error.rate_limited", "Too many requests. Try again soon."],
            "microsoft-todo-timeout": ["microsofttodo.error.timeout", "Microsoft did not respond in time."],
            "microsoft-todo-unavailable": ["microsofttodo.error.unavailable", "Microsoft To Do is temporarily unavailable."],
            "microsoft-todo-storage-unavailable": ["microsofttodo.error.storage", "Microsoft To Do session storage is temporarily unavailable."],
            "microsoft-todo-invalid-title": ["microsofttodo.error.title", "Enter a task or list name."],
            "microsoft-todo-invalid-date": ["microsofttodo.error.date", "Use a valid due date in YYYY-MM-DD format."],
            "auth/unavailable": ["microsofttodo.error.rekindle_auth", "Sign in to ReKindle first."],
            "auth/timeout": ["microsofttodo.error.rekindle_auth", "Sign in to ReKindle first."],
            "auth/restore-failed": ["microsofttodo.error.rekindle_auth", "Sign in to ReKindle first."]
        };
        if (messages[code]) return translate(messages[code][0], messages[code][1]);
        if (error && error.message === "Please sign in first.") return translate("microsofttodo.error.rekindle_auth", "Sign in to ReKindle first.");
        return error && error.message || translate("microsofttodo.error.connection", "Could not reach Microsoft To Do.");
    }

    function request(action, body) {
        if (isDemo) return demoRequest(action, body || {});
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
        return window.RekindleCloud.request("/microsoft-todo/" + action, {
            method: "POST",
            body: body || {},
            signal: controller ? controller.signal : undefined
        }).catch(function (error) {
            if (error && error.name === "AbortError") {
                var timeout = new Error(translate("microsofttodo.error.timeout", "Microsoft did not respond in time."));
                timeout.code = "microsoft-todo-timeout";
                throw timeout;
            }
            throw error;
        }).finally(function () {
            if (timer) clearTimeout(timer);
        });
    }

    function initializeFirebase() {
        if (isDemo) {
            handleStatus({ authorized: true, stage: "connected" });
            return;
        }
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) {
            showSignedOut();
            return;
        }
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleMicrosoftTodoFirebaseConfig);
            firebase.auth().onAuthStateChanged(function (user) {
                if (!user) {
                    showSignedOut();
                    return;
                }
                loadStatus();
            }, function () {
                showSignedOut();
            });
        } catch (error) {
            showSignedOut();
        }
    }

    function showSignedOut() {
        authorized = false;
        cancelPolling();
        showView("setup-view");
        showStage("signed-out");
        setStatus(translate("microsofttodo.status.sign_in", "Sign in to ReKindle first"));
    }

    async function loadStatus() {
        setStatus(translate("microsofttodo.status.checking", "Checking Microsoft To Do..."));
        try {
            handleStatus(await request("status", {}));
        } catch (error) {
            showView("setup-view");
            showStage("start");
            setStatus(translate("microsofttodo.status.connection_failed", "Connection failed"));
            showError(error);
        }
    }

    function handleStatus(result) {
        authorized = result && result.authorized === true;
        showView("setup-view");
        if (authorized) {
            cancelPolling();
            showStage("connected");
            setStatus(translate("microsofttodo.status.connected", "Microsoft To Do connected"));
            openTasks();
            return;
        }
        if (result && result.stage === "code") {
            renderDeviceCode(result);
            schedulePoll(result.retryAfter || 5);
            return;
        }
        cancelPolling();
        showStage("start");
        setStatus(translate("microsofttodo.status.ready", "Ready"));
    }

    async function startAuthorization() {
        var button = byId("connect-button");
        setBusy(button, true, translate("microsofttodo.state.starting", "Getting code..."), translate("microsofttodo.auth.connect_button", "Get sign-in code"));
        setStatus(translate("microsofttodo.state.starting", "Getting sign-in code..."));
        try {
            var result = await request("start", {});
            renderDeviceCode(result);
            schedulePoll(result.retryAfter || 5);
        } catch (error) {
            setStatus(translate("microsofttodo.status.connection_failed", "Connection failed"));
            showError(error);
        } finally {
            setBusy(button, false, "", translate("microsofttodo.auth.connect_button", "Get sign-in code"));
        }
    }

    function renderDeviceCode(result) {
        showView("setup-view");
        showStage("code");
        setText(byId("device-code"), result.userCode || "---- ----");
        var link = byId("verification-link");
        var uri = String(result.verificationUri || "https://microsoft.com/devicelogin");
        link.href = uri;
        setText(link, uri);
        expiresAt = Number(result.expiresAt || 0);
        updateExpiryText();
        setStatus(translate("microsofttodo.status.waiting", "Waiting for Microsoft approval..."));
    }

    function updateExpiryText() {
        var remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
        var text = remaining > 0
            ? template("microsofttodo.auth.expires", "Code expires in about ${minutes} minutes.", { minutes: remaining })
            : translate("microsofttodo.auth.expired", "This code has expired.");
        setText(byId("code-expiry"), text);
    }

    function schedulePoll(seconds) {
        cancelPolling();
        var delay = Math.max(3, Number(seconds || 5)) * 1000;
        pollTimer = setTimeout(function () { pollAuthorization(false); }, delay);
    }

    function cancelPolling() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
    }

    async function pollAuthorization(manual) {
        cancelPolling();
        updateExpiryText();
        var button = byId("check-button");
        if (manual) setBusy(button, true, translate("microsofttodo.state.checking", "Checking..."), translate("microsofttodo.auth.check_button", "I approved it"));
        try {
            var result = await request("poll", {});
            if (result.authorized) {
                authorized = true;
                showStage("connected");
                setStatus(translate("microsofttodo.status.connected", "Microsoft To Do connected"));
                openTasks();
                return;
            }
            renderDeviceCode(result);
            schedulePoll(result.retryAfter || 5);
        } catch (error) {
            if (error && (error.code === "microsoft-todo-auth-expired" || error.code === "microsoft-todo-auth-declined")) {
                showStage("start");
                setStatus(translate("microsofttodo.status.ready", "Ready"));
            } else {
                schedulePoll(10);
            }
            if (manual || error && error.code !== "microsoft-todo-unavailable") showError(error);
        } finally {
            if (manual) setBusy(button, false, "", translate("microsofttodo.auth.check_button", "I approved it"));
        }
    }

    function restartAuthorization() {
        cancelPolling();
        showStage("start");
        setStatus(translate("microsofttodo.status.ready", "Ready"));
    }

    function openSetup() {
        showView("setup-view");
        showStage(authorized ? "connected" : "start");
        setStatus(authorized
            ? translate("microsofttodo.status.connected", "Microsoft To Do connected")
            : translate("microsofttodo.status.ready", "Ready"));
    }

    async function openTasks() {
        if (!authorized) {
            openSetup();
            return;
        }
        showView("tasks-view");
        await loadLists();
    }

    async function loadLists(preferredId) {
        setStatus(translate("microsofttodo.state.loading_lists", "Loading task lists..."));
        setText(byId("list-nav"), "");
        showTaskLoading(translate("microsofttodo.state.loading_lists", "Loading task lists..."));
        try {
            var result = await request("lists", {});
            lists = Array.isArray(result.lists) ? result.lists : [];
            renderLists();
            if (!lists.length) {
                currentList = null;
                setText(byId("list-title"), translate("microsofttodo.lists", "Lists"));
                tasks = [];
                renderTasks();
                setStatus(translate("microsofttodo.status.no_lists", "Create a Microsoft To Do list to begin"));
                return;
            }
            var selected = findList(preferredId) || findList(currentList && currentList.id) || defaultList() || lists[0];
            await selectList(selected.id);
        } catch (error) {
            showError(error);
            setStatus(translate("microsofttodo.status.connection_failed", "Connection failed"));
        }
    }

    function findList(id) {
        if (!id) return null;
        for (var i = 0; i < lists.length; i++) if (lists[i].id === id) return lists[i];
        return null;
    }

    function defaultList() {
        for (var i = 0; i < lists.length; i++) {
            if (lists[i].wellknownListName === "defaultList") return lists[i];
        }
        return null;
    }

    function renderLists() {
        var nav = byId("list-nav");
        nav.innerHTML = "";
        for (var i = 0; i < lists.length; i++) {
            var list = lists[i];
            var button = document.createElement("button");
            button.type = "button";
            button.className = "list-button" + (currentList && currentList.id === list.id ? " active" : "");
            button.setAttribute("data-list-id", list.id);
            setText(button, list.displayName);
            button.onclick = selectListFromButton;
            nav.appendChild(button);
        }
    }

    function selectListFromButton(event) {
        var id = event.currentTarget.getAttribute("data-list-id");
        selectList(id);
    }

    async function selectList(id) {
        var list = findList(id);
        if (!list) return;
        currentList = list;
        currentTask = null;
        setText(byId("list-title"), list.displayName);
        renderLists();
        await loadTasks();
    }

    async function loadTasks() {
        if (!currentList) return;
        showTaskLoading(translate("microsofttodo.loading", "Loading tasks..."));
        setStatus(translate("microsofttodo.state.loading_tasks", "Loading tasks..."));
        try {
            var result = await request("tasks", { listId: currentList.id });
            tasks = Array.isArray(result.tasks) ? result.tasks : [];
            renderTasks();
            setStatus(template("microsofttodo.status.synced", "Synced ${count} tasks", { count: tasks.length }));
        } catch (error) {
            showError(error);
            setStatus(translate("microsofttodo.status.connection_failed", "Connection failed"));
            hideTaskLoading();
        }
    }

    function showTaskLoading(text) {
        var list = byId("task-list");
        var rows = list.querySelectorAll(".task-row");
        for (var i = 0; i < rows.length; i++) rows[i].remove();
        byId("empty-state").classList.remove("active");
        var loading = byId("tasks-loading");
        setText(loading, text);
        loading.style.display = "block";
    }

    function hideTaskLoading() {
        byId("tasks-loading").style.display = "none";
    }

    function filteredTasks() {
        var result = tasks.filter(function (task) {
            if (currentFilter === "active") return task.status !== "completed";
            if (currentFilter === "completed") return task.status === "completed";
            return true;
        });
        return result.sort(compareTasks);
    }

    function compareTasks(a, b) {
        var aDone = a.status === "completed" ? 1 : 0;
        var bDone = b.status === "completed" ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        var importance = { high: 0, normal: 1, low: 2 };
        if (importance[a.importance] !== importance[b.importance]) return importance[a.importance] - importance[b.importance];
        var aDue = a.dueDate || "9999-99-99";
        var bDue = b.dueDate || "9999-99-99";
        if (aDue < bDue) return -1;
        if (aDue > bDue) return 1;
        return String(a.title || "").localeCompare(String(b.title || ""));
    }

    function renderTasks() {
        hideTaskLoading();
        var list = byId("task-list");
        var oldRows = list.querySelectorAll(".task-row");
        for (var i = 0; i < oldRows.length; i++) oldRows[i].remove();
        var visible = filteredTasks();
        var empty = byId("empty-state");
        empty.classList.toggle("active", visible.length === 0);

        for (var j = 0; j < visible.length; j++) list.insertBefore(createTaskRow(visible[j]), empty);
        var openCount = tasks.filter(function (task) { return task.status !== "completed"; }).length;
        setText(byId("task-count"), template("microsofttodo.count.open", "${count} open", { count: openCount }));
    }

    function createTaskRow(task) {
        var row = document.createElement("div");
        row.className = "task-row" + (task.status === "completed" ? " completed" : "");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.setAttribute("data-task-id", task.id);
        row.onclick = openTaskFromRow;
        row.onkeydown = function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openTaskFromRow(event);
            }
        };

        var check = document.createElement("button");
        check.type = "button";
        check.className = "check-button";
        check.setAttribute("aria-label", task.status === "completed" ? "Mark active" : "Mark complete");
        check.setAttribute("data-task-id", task.id);
        setText(check, task.status === "completed" ? "X" : "");
        check.onclick = function (event) {
            event.stopPropagation();
            toggleComplete(event.currentTarget.getAttribute("data-task-id"), event.currentTarget);
        };

        var copy = document.createElement("div");
        copy.className = "task-copy";
        var title = document.createElement("span");
        title.className = "task-title";
        setText(title, task.title);
        var meta = document.createElement("span");
        meta.className = "task-meta";
        var metaParts = [];
        if (task.dueDate) metaParts.push(template("microsofttodo.meta.due", "Due ${date}", { date: task.dueDate }));
        if (task.notes) metaParts.push(translate("microsofttodo.meta.notes", "Has notes"));
        if (task.status === "completed") metaParts.push(translate("microsofttodo.meta.completed", "Completed"));
        setText(meta, metaParts.join(" / "));
        copy.appendChild(title);
        if (metaParts.length) copy.appendChild(meta);

        var importance = document.createElement("span");
        importance.className = "importance-mark";
        setText(importance, task.importance === "high" ? "!" : (task.importance === "low" ? "-" : ""));

        row.appendChild(check);
        row.appendChild(copy);
        row.appendChild(importance);
        return row;
    }

    function taskById(id) {
        for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
        return null;
    }

    function openTaskFromRow(event) {
        var row = event.currentTarget;
        openTask(row.getAttribute("data-task-id"));
    }

    function openTask(id) {
        currentTask = taskById(id);
        if (!currentTask) return;
        byId("detail-title").value = currentTask.title || "";
        byId("detail-due").value = currentTask.dueDate || "";
        byId("detail-importance").value = currentTask.importance || "normal";
        byId("detail-notes").value = currentTask.notes || "";
        openModal("task-modal");
    }

    async function addTask(event) {
        if (event) event.preventDefault();
        if (!currentList) return;
        var titleInput = byId("quick-title");
        var title = titleInput.value.trim();
        if (!title) return;
        var button = byId("quick-add-button");
        button.disabled = true;
        setStatus(translate("microsofttodo.state.saving", "Saving task..."));
        try {
            var result = await request("create", {
                listId: currentList.id,
                title: title,
                dueDate: byId("quick-due").value.trim(),
                importance: "normal"
            });
            titleInput.value = "";
            byId("quick-due").value = "";
            if (result.task) tasks.push(result.task);
            renderTasks();
            setStatus(translate("microsofttodo.status.saved", "Task saved"));
        } catch (error) {
            showError(error);
            setStatus(translate("microsofttodo.status.save_failed", "Could not save task"));
        } finally {
            button.disabled = false;
        }
    }

    async function toggleComplete(id, button) {
        var task = taskById(id);
        if (!task || !currentList) return;
        button.disabled = true;
        var nextStatus = task.status === "completed" ? "notStarted" : "completed";
        try {
            var result = await request("update", {
                listId: currentList.id,
                taskId: task.id,
                status: nextStatus
            });
            replaceTask(result.task || Object.assign({}, task, { status: nextStatus }));
            renderTasks();
            setStatus(nextStatus === "completed"
                ? translate("microsofttodo.status.completed", "Task completed")
                : translate("microsofttodo.status.reopened", "Task reopened"));
        } catch (error) {
            showError(error);
        } finally {
            button.disabled = false;
        }
    }

    async function saveTask(event) {
        if (event) event.preventDefault();
        if (!currentTask || !currentList) return;
        var button = byId("save-task-button");
        setBusy(button, true, translate("microsofttodo.state.saving", "Saving..."), translate("microsofttodo.details.save", "Save"));
        try {
            var result = await request("update", {
                listId: currentList.id,
                taskId: currentTask.id,
                title: byId("detail-title").value.trim(),
                dueDate: byId("detail-due").value.trim(),
                importance: byId("detail-importance").value,
                notes: byId("detail-notes").value
            });
            replaceTask(result.task);
            closeModal("task-modal");
            renderTasks();
            setStatus(translate("microsofttodo.status.saved", "Task saved"));
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("microsofttodo.details.save", "Save"));
        }
    }

    function replaceTask(task) {
        if (!task) return;
        for (var i = 0; i < tasks.length; i++) {
            if (tasks[i].id === task.id) {
                tasks[i] = task;
                if (currentTask && currentTask.id === task.id) currentTask = task;
                return;
            }
        }
        tasks.push(task);
    }

    function openDelete() {
        closeModal("task-modal");
        openModal("delete-modal");
    }

    async function deleteTask() {
        if (!currentTask || !currentList) return;
        var button = byId("delete-task-button");
        setBusy(button, true, translate("microsofttodo.state.deleting", "Deleting..."), translate("common.delete", "Delete"));
        try {
            await request("delete", { listId: currentList.id, taskId: currentTask.id });
            tasks = tasks.filter(function (task) { return task.id !== currentTask.id; });
            currentTask = null;
            closeModal("delete-modal");
            renderTasks();
            setStatus(translate("microsofttodo.status.deleted", "Task deleted"));
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("common.delete", "Delete"));
        }
    }

    function setFilter(filter) {
        currentFilter = filter;
        var names = ["all", "active", "completed"];
        for (var i = 0; i < names.length; i++) {
            byId("filter-" + names[i]).classList.toggle("active", names[i] === filter);
        }
        renderTasks();
    }

    function openNewList() {
        byId("new-list-name").value = "";
        openModal("new-list-modal");
    }

    async function createList(event) {
        if (event) event.preventDefault();
        var name = byId("new-list-name").value.trim();
        if (!name) return;
        var button = byId("create-list-button");
        setBusy(button, true, translate("microsofttodo.state.creating", "Creating..."), translate("common.create", "Create"));
        try {
            var result = await request("create-list", { displayName: name });
            closeModal("new-list-modal");
            await loadLists(result.list && result.list.id);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("common.create", "Create"));
        }
    }

    function openLogout() {
        openModal("logout-modal");
    }

    async function logout() {
        var button = byId("logout-button");
        setBusy(button, true, translate("microsofttodo.state.disconnecting", "Disconnecting..."), translate("microsofttodo.auth.disconnect_button", "Disconnect"));
        try {
            await request("logout", {});
            authorized = false;
            lists = [];
            tasks = [];
            currentList = null;
            currentTask = null;
            closeModal("logout-modal");
            showView("setup-view");
            showStage("start");
            setStatus(translate("microsofttodo.status.disconnected", "Microsoft To Do disconnected"));
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("microsofttodo.auth.disconnect_button", "Disconnect"));
        }
    }

    function bindEvents() {
        byId("quick-add-form").addEventListener("submit", addTask);
        byId("task-form").addEventListener("submit", saveTask);
        byId("new-list-form").addEventListener("submit", createList);
        var modals = document.querySelectorAll(".modal-overlay");
        for (var i = 0; i < modals.length; i++) {
            modals[i].addEventListener("click", function (event) {
                if (event.target === event.currentTarget) event.currentTarget.style.display = "none";
            });
        }
        window.addEventListener("pagehide", cancelPolling);
    }

    var demoData = {
        lists: [
            { id: "demo-tasks", displayName: "Tasks", isOwner: true, isShared: false, wellknownListName: "defaultList" },
            { id: "demo-work", displayName: "Kindle project", isOwner: true, isShared: false, wellknownListName: "none" },
            { id: "demo-reading", displayName: "Reading list", isOwner: true, isShared: false, wellknownListName: "none" }
        ],
        tasks: {
            "demo-tasks": [
                { id: "task-1", title: "Review the weekly plan", status: "notStarted", importance: "high", dueDate: demoDate(0), notes: "Keep the list short and actionable." },
                { id: "task-2", title: "Charge the Kindle", status: "notStarted", importance: "normal", dueDate: demoDate(1), notes: "" },
                { id: "task-3", title: "Archive finished notes", status: "completed", importance: "low", dueDate: "", notes: "" }
            ],
            "demo-work": [
                { id: "task-4", title: "Test touch targets on Chromium 75", status: "notStarted", importance: "high", dueDate: demoDate(2), notes: "All controls should be at least 48 by 48 pixels." },
                { id: "task-5", title: "Check Russian localization", status: "inProgress", importance: "normal", dueDate: "", notes: "" }
            ],
            "demo-reading": []
        }
    };

    function demoDate(offset) {
        var date = new Date(Date.now() + offset * 86400000);
        return date.getFullYear() + "-" + padTwo(date.getMonth() + 1) + "-" + padTwo(date.getDate());
    }

    function padTwo(value) {
        return value < 10 ? "0" + value : String(value);
    }

    function demoRequest(action, body) {
        return new Promise(function (resolve) {
            setTimeout(function () {
                if (action === "status") return resolve({ authorized: true, stage: "connected" });
                if (action === "start") return resolve({ authorized: false, stage: "code", userCode: "EINK-2026", verificationUri: "https://microsoft.com/devicelogin", expiresAt: Date.now() + 900000, retryAfter: 5 });
                if (action === "poll") return resolve({ authorized: true, stage: "connected" });
                if (action === "logout") return resolve({ authorized: false, stage: "start" });
                if (action === "lists") return resolve({ lists: demoData.lists.slice() });
                if (action === "tasks") return resolve({ tasks: (demoData.tasks[body.listId] || []).map(clone) });
                if (action === "create-list") {
                    var list = { id: "list-" + Date.now(), displayName: body.displayName, isOwner: true, isShared: false, wellknownListName: "none" };
                    demoData.lists.push(list);
                    demoData.tasks[list.id] = [];
                    return resolve({ list: clone(list) });
                }
                if (action === "create") {
                    var task = { id: "task-" + Date.now(), title: body.title, status: "notStarted", importance: body.importance || "normal", dueDate: body.dueDate || "", notes: body.notes || "" };
                    demoData.tasks[body.listId] = demoData.tasks[body.listId] || [];
                    demoData.tasks[body.listId].push(task);
                    return resolve({ task: clone(task) });
                }
                if (action === "update") {
                    var items = demoData.tasks[body.listId] || [];
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].id === body.taskId) {
                            ["title", "status", "importance", "dueDate", "notes"].forEach(function (key) {
                                if (body[key] !== undefined) items[i][key] = body[key];
                            });
                            return resolve({ task: clone(items[i]) });
                        }
                    }
                }
                if (action === "delete") {
                    demoData.tasks[body.listId] = (demoData.tasks[body.listId] || []).filter(function (task) { return task.id !== body.taskId; });
                    return resolve({ deleted: true });
                }
                resolve({});
            }, 120);
        });
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    window.microsoftTodoApp = {
        startAuthorization: startAuthorization,
        pollAuthorization: pollAuthorization,
        restartAuthorization: restartAuthorization,
        openSetup: openSetup,
        openTasks: openTasks,
        selectList: selectList,
        setFilter: setFilter,
        openNewList: openNewList,
        openDelete: openDelete,
        deleteTask: deleteTask,
        openLogout: openLogout,
        logout: logout,
        closeModal: closeModal,
        refresh: loadTasks
    };

    document.addEventListener("DOMContentLoaded", function () {
        bindEvents();
        if (window.rekindleApplyWallpaper) window.rekindleApplyWallpaper();
        initializeFirebase();
    });
})();
