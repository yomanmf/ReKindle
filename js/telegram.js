(function () {
    "use strict";

    var REQUEST_TIMEOUT_MS = 25000;
    var isDemo = window.location.search.indexOf("demo=1") !== -1;
    var currentChat = null;
    var currentMessages = [];
    var oldestOffsetId = null;
    var authorized = false;
    var account = null;
    var proxyInfo = { enabled: false };
    var chats = [];

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

    function setBusy(button, busy, busyText, normalText) {
        if (!button) return;
        button.disabled = busy;
        setText(button, busy ? busyText : normalText);
    }

    function setStatus(value) {
        setText(byId("status-bar"), value);
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
        if (!target) target = byId("stage-phone");
        if (target) target.classList.add("active");
    }

    function showError(error) {
        setText(byId("error-message"), describeError(error));
        byId("error-modal").style.display = "flex";
    }

    function closeError() {
        byId("error-modal").style.display = "none";
    }

    function describeError(error) {
        var code = String(error && error.code || "");
        var messages = {
            "telegram-phone-invalid": ["telegram.error.phone", "Enter a valid phone number in international format."],
            "telegram-proxy-host-invalid": ["telegram.error.proxy_host", "Enter a valid public MTProxy host."],
            "telegram-proxy-port-invalid": ["telegram.error.proxy_port", "Enter a valid MTProxy port."],
            "telegram-proxy-secret-invalid": ["telegram.error.proxy_secret", "Enter a valid MTProxy secret."],
            "telegram-proxy-unresolved": ["telegram.error.proxy_unresolved", "The MTProxy host could not be resolved."],
            "telegram-proxy-private": ["telegram.error.proxy_private", "Private or local MTProxy addresses are not allowed."],
            "telegram-email-invalid": ["telegram.error.email", "Enter a valid email address."],
            "telegram-code-invalid": ["telegram.error.code", "The verification code is invalid."],
            "telegram-password-invalid": ["telegram.error.password", "The two-step verification password is incorrect."],
            "telegram-auth-expired": ["telegram.error.auth_expired", "The login attempt expired. Start again."],
            "telegram-session-expired": ["telegram.error.session_expired", "The Telegram session expired. Sign in again."],
            "telegram-rate-limited": ["telegram.error.rate_limited", "Telegram temporarily limited requests. Try again later."],
            "telegram-registration-required": ["telegram.error.registration", "Create the Telegram account in the official app first."],
            "telegram-recaptcha-required": ["telegram.error.recaptcha", "Telegram requested an additional verification step that is not available on Kindle."],
            "telegram-configuration": ["telegram.error.configuration", "The ReKindle Telegram service is not configured yet."],
            "telegram-unavailable": ["telegram.error.unavailable", "Telegram did not respond in time."],
            "auth/unavailable": ["telegram.error.rekindle_auth", "Sign in to ReKindle first."],
            "auth/timeout": ["telegram.error.rekindle_auth", "Sign in to ReKindle first."],
            "auth/restore-failed": ["telegram.error.rekindle_auth", "Sign in to ReKindle first."]
        };
        if (messages[code]) return translate(messages[code][0], messages[code][1]);
        if (error && error.message === "Please sign in first.") return translate("telegram.error.rekindle_auth", "Sign in to ReKindle first.");
        return error && error.message || translate("telegram.error.connection", "Could not reach the ReKindle Telegram service.");
    }

    function request(action, body) {
        if (isDemo) return demoRequest(action, body || {});
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
        return window.RekindleCloud.request("/telegram/" + action, {
            method: "POST",
            body: body || {},
            signal: controller ? controller.signal : undefined
        }).catch(function (error) {
            if (error && error.name === "AbortError") {
                var timeout = new Error(translate("telegram.error.unavailable", "Telegram did not respond in time."));
                timeout.code = "telegram-unavailable";
                throw timeout;
            }
            throw error;
        }).finally(function () {
            if (timer) clearTimeout(timer);
        });
    }

    function initializeFirebase() {
        if (isDemo) {
            handleStatus(demoStatus());
            return;
        }
        if (typeof firebase === "undefined" || !firebase.auth || !window.RekindleCloud) {
            showSignedOut();
            return;
        }
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.rekindleTelegramFirebaseConfig);
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
        showView("setup-view");
        showStage("signed-out");
        setStatus(translate("telegram.status.sign_in", "Sign in to ReKindle first"));
    }

    async function loadStatus() {
        setStatus(translate("telegram.state.checking", "Checking Telegram session..."));
        try {
            handleStatus(await request("status", {}));
        } catch (error) {
            showView("setup-view");
            showStage("phone");
            setStatus(translate("telegram.status.connection_failed", "Connection failed"));
            showError(error);
        }
    }

    function handleStatus(result) {
        authorized = result && result.authorized === true;
        account = result && result.account || null;
        proxyInfo = result && result.proxy || proxyInfo;
        showView("setup-view");
        if (authorized) {
            renderConnectedAccount();
            showStage("connected");
            setStatus(translate("telegram.status.connected", "Telegram connected"));
            loadChats();
            return;
        }
        showStage(result && result.stage || "phone");
        updateDelivery(result || {});
        setStatus(translate("telegram.status.ready", "Ready"));
    }

    function updateDelivery(result) {
        var delivery = result.delivery === "app"
            ? translate("telegram.auth.code_app", "Telegram sent the code to your other Telegram app.")
            : translate("telegram.auth.code_other", "Enter the code sent by Telegram.");
        setText(byId("code-delivery"), delivery);
        var pattern = String(result.emailPattern || "");
        setText(byId("email-code-note"), pattern
            ? template("telegram.auth.email_sent", "Telegram sent a code to ${email}.", { email: pattern })
            : translate("telegram.auth.email_code_help", "Enter the code Telegram sent by email."));
    }

    function renderConnectedAccount() {
        account = account || {};
        setText(byId("account-name"), account.displayName || "Telegram");
        var details = [];
        if (account.username) details.push("@" + account.username);
        if (account.phone) details.push(account.phone);
        setText(byId("account-details"), details.join("  "));
        setText(byId("toolbar-account"), account.displayName || "Telegram");
        setText(byId("proxy-status"), proxyInfo && proxyInfo.enabled
            ? template("telegram.proxy.active", "MTProxy: ${host}:${port}", { host: proxyInfo.host, port: proxyInfo.port })
            : translate("telegram.proxy.direct", "Direct Telegram connection"));
    }

    async function startAuth(event) {
        if (event) event.preventDefault();
        var button = byId("phone-submit");
        setBusy(button, true, translate("telegram.state.sending_code", "Sending code..."), translate("telegram.auth.send_code", "Send code"));
        setStatus(translate("telegram.state.sending_code", "Sending code..."));
        try {
            var result = await request("start", {
                phone: byId("phone-input").value,
                proxy: readProxyForm("auth")
            });
            showStage(result.stage || "code");
            updateDelivery(result);
            setStatus(translate("telegram.status.code_sent", "Verification code sent"));
        } catch (error) {
            showError(error);
            setStatus(translate("telegram.status.connection_failed", "Connection failed"));
        } finally {
            setBusy(button, false, "", translate("telegram.auth.send_code", "Send code"));
        }
    }

    async function submitCode(event) {
        if (event) event.preventDefault();
        var button = byId("code-submit");
        setBusy(button, true, translate("telegram.state.verifying", "Verifying..."), translate("telegram.auth.continue", "Continue"));
        try {
            var result = await request("confirm", { code: byId("code-input").value });
            byId("code-input").value = "";
            handleStatus(result);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.auth.continue", "Continue"));
        }
    }

    async function submitEmail(event) {
        if (event) event.preventDefault();
        var button = byId("email-submit");
        setBusy(button, true, translate("telegram.state.verifying", "Verifying..."), translate("telegram.auth.continue", "Continue"));
        try {
            var result = await request("email-start", { email: byId("email-input").value });
            showStage(result.stage || "email-code");
            updateDelivery(result);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.auth.continue", "Continue"));
        }
    }

    async function submitEmailCode(event) {
        if (event) event.preventDefault();
        var button = byId("email-code-submit");
        setBusy(button, true, translate("telegram.state.verifying", "Verifying..."), translate("telegram.auth.continue", "Continue"));
        try {
            var result = await request("email-confirm", { code: byId("email-code-input").value });
            byId("email-code-input").value = "";
            showStage(result.stage || "code");
            updateDelivery(result);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.auth.continue", "Continue"));
        }
    }

    async function submitPassword(event) {
        if (event) event.preventDefault();
        var button = byId("password-submit");
        setBusy(button, true, translate("telegram.state.verifying", "Verifying..."), translate("telegram.auth.continue", "Continue"));
        try {
            var result = await request("password", { password: byId("password-input").value });
            byId("password-input").value = "";
            handleStatus(result);
        } catch (error) {
            byId("password-input").value = "";
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.auth.continue", "Continue"));
        }
    }

    function restartAuth() {
        showStage("phone");
        byId("code-input").value = "";
        byId("email-input").value = "";
        byId("email-code-input").value = "";
        byId("password-input").value = "";
        setStatus(translate("telegram.status.ready", "Ready"));
    }

    function openSetup() {
        showView("setup-view");
        if (authorized) {
            renderConnectedAccount();
            showStage("connected");
        }
    }

    function openLogout() {
        byId("logout-modal").style.display = "flex";
    }

    function closeLogout() {
        byId("logout-modal").style.display = "none";
    }

    async function logOut() {
        var button = byId("logout-confirm");
        setBusy(button, true, translate("telegram.state.disconnecting", "Disconnecting..."), translate("telegram.auth.logout_confirm", "Disconnect"));
        try {
            await request("logout", {});
            closeLogout();
            authorized = false;
            account = null;
            proxyInfo = { enabled: false };
            chats = [];
            currentChat = null;
            showView("setup-view");
            showStage("phone");
            setStatus(translate("telegram.status.disconnected", "Telegram disconnected"));
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.auth.logout_confirm", "Disconnect"));
        }
    }

    function readProxyForm(prefix) {
        var enabled = byId(prefix + "-proxy-enabled").checked;
        if (!enabled) return { enabled: false };
        return {
            enabled: true,
            host: byId(prefix + "-proxy-host").value,
            port: byId(prefix + "-proxy-port").value,
            secret: byId(prefix + "-proxy-secret").value
        };
    }

    function toggleProxyFields(prefix) {
        var fields = byId(prefix + "-proxy-fields");
        fields.style.display = byId(prefix + "-proxy-enabled").checked ? "block" : "none";
    }

    function openProxySettings() {
        if (!authorized) return;
        byId("settings-proxy-enabled").checked = proxyInfo && proxyInfo.enabled === true;
        byId("settings-proxy-host").value = proxyInfo && proxyInfo.host || "";
        byId("settings-proxy-port").value = proxyInfo && proxyInfo.port || "";
        byId("settings-proxy-secret").value = "";
        toggleProxyFields("settings");
        showView("setup-view");
        showStage("proxy");
    }

    async function saveProxy(event) {
        if (event) event.preventDefault();
        var button = byId("proxy-save");
        setBusy(button, true, translate("telegram.state.saving", "Saving..."), translate("telegram.proxy.save", "Save proxy"));
        try {
            var result = await request("proxy", readProxyForm("settings"));
            proxyInfo = result.proxy || { enabled: false };
            renderConnectedAccount();
            showStage("connected");
            setStatus(translate("telegram.proxy.saved", "MTProxy settings saved"));
        } catch (error) {
            showError(error);
        } finally {
            byId("settings-proxy-secret").value = "";
            setBusy(button, false, "", translate("telegram.proxy.save", "Save proxy"));
        }
    }

    async function removeProxy() {
        byId("settings-proxy-enabled").checked = false;
        toggleProxyFields("settings");
        await saveProxy();
    }

    async function loadChats(event) {
        if (event) event.preventDefault();
        if (!authorized) {
            openSetup();
            return;
        }
        showView("chats-view");
        renderLoading(byId("chat-list"), translate("telegram.state.loading_chats", "Loading Telegram chats..."));
        setStatus(translate("telegram.state.loading_chats", "Loading Telegram chats..."));
        try {
            var query = byId("chat-search").value || "";
            var result = await request("chats", { query: query, limit: 75 });
            chats = result.items || [];
            renderChats();
            setStatus(template("telegram.status.chat_count", "${count} chats", { count: chats.length }));
        } catch (error) {
            chats = [];
            renderEmpty(byId("chat-list"), describeError(error));
            showError(error);
        }
    }

    function renderChats() {
        var list = byId("chat-list");
        list.innerHTML = "";
        if (!chats.length) {
            renderEmpty(list, translate("telegram.state.no_chats", "No Telegram chats found."));
            return;
        }
        chats.forEach(function (chat, index) {
            var row = document.createElement("button");
            row.type = "button";
            row.className = "chat-row";
            row.onclick = function () { openChat(index); };

            var main = document.createElement("span");
            main.className = "chat-main";
            var title = document.createElement("span");
            title.className = "chat-title";
            setText(title, chat.title || translate("telegram.chat.untitled", "Untitled chat"));
            var preview = document.createElement("span");
            preview.className = "chat-meta";
            setText(preview, chat.preview || translate("telegram.state.no_messages", "No messages yet."));
            main.appendChild(title);
            main.appendChild(preview);

            var side = document.createElement("span");
            side.className = "chat-side";
            var time = document.createElement("span");
            setText(time, relativeTime(chat.date));
            side.appendChild(time);
            if (Number(chat.unreadCount || 0) > 0) {
                var badge = document.createElement("span");
                badge.className = "unread-badge";
                setText(badge, chat.unreadCount > 99 ? "99+" : chat.unreadCount);
                side.appendChild(document.createElement("br"));
                side.appendChild(badge);
            }
            row.appendChild(main);
            row.appendChild(side);
            list.appendChild(row);
        });
    }

    async function openChat(index) {
        currentChat = chats[index];
        if (!currentChat) return;
        currentMessages = [];
        oldestOffsetId = null;
        setText(byId("conversation-title"), currentChat.title || "Telegram");
        setText(byId("conversation-subtitle"), chatTypeLabel(currentChat));
        byId("composer-form").style.display = currentChat.readOnly ? "none" : "flex";
        byId("read-only-note").style.display = currentChat.readOnly ? "block" : "none";
        showView("conversation-view");
        await refreshMessages();
    }

    function chatTypeLabel(chat) {
        if (chat.type === "channel") return translate("telegram.chat.channel", "Channel");
        if (chat.type === "group") return translate("telegram.chat.group", "Group");
        return translate("telegram.chat.private", "Private chat");
    }

    async function refreshMessages() {
        if (!currentChat) return;
        renderLoading(byId("message-list"), translate("telegram.state.loading_messages", "Loading messages..."));
        setStatus(translate("telegram.state.loading_messages", "Loading messages..."));
        try {
            var result = await request("messages", { chatRef: currentChat.chatRef, limit: 30 });
            currentMessages = result.items || [];
            oldestOffsetId = result.nextOffsetId || null;
            renderMessages();
            byId("older-row").style.display = result.hasMore ? "block" : "none";
            setStatus(translate("telegram.status.updated", "Updated"));
            if (currentMessages.length) {
                request("read", {
                    chatRef: currentChat.chatRef,
                    maxId: currentMessages[currentMessages.length - 1].id
                }).catch(function () {});
            }
        } catch (error) {
            currentMessages = [];
            renderEmpty(byId("message-list"), describeError(error));
            showError(error);
        }
    }

    async function loadOlderMessages() {
        if (!currentChat || !oldestOffsetId) return;
        var button = byId("older-button");
        setBusy(button, true, translate("telegram.state.loading_messages", "Loading messages..."), translate("telegram.chat.load_older", "Load older messages"));
        try {
            var result = await request("messages", {
                chatRef: currentChat.chatRef,
                limit: 30,
                offsetId: oldestOffsetId
            });
            mergeMessages(result.items || []);
            oldestOffsetId = result.nextOffsetId || oldestOffsetId;
            byId("older-row").style.display = result.hasMore ? "block" : "none";
            renderMessages(false);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.chat.load_older", "Load older messages"));
        }
    }

    function mergeMessages(older) {
        var known = {};
        currentMessages.forEach(function (message) { known[String(message.id)] = true; });
        older.forEach(function (message) {
            if (!known[String(message.id)]) currentMessages.push(message);
        });
        currentMessages.sort(function (left, right) { return Number(left.id) - Number(right.id); });
    }

    function renderMessages(scrollToEnd) {
        var list = byId("message-list");
        list.innerHTML = "";
        if (!currentMessages.length) {
            renderEmpty(list, translate("telegram.state.no_messages", "No messages in this chat yet."));
            return;
        }
        currentMessages.forEach(function (message) {
            var row = document.createElement("div");
            row.className = "message-row" + (message.outgoing ? " self" : "");
            var bubble = document.createElement("div");
            bubble.className = "message-bubble";
            if (!message.outgoing && message.sender) {
                var sender = document.createElement("div");
                sender.className = "message-sender";
                setText(sender, message.sender);
                bubble.appendChild(sender);
            }
            var text = document.createElement("div");
            text.className = "message-text";
            setText(text, localizeAttachment(message.text));
            bubble.appendChild(text);
            if (message.attachment) {
                var attachment = document.createElement("div");
                attachment.className = "attachment-note";
                setText(attachment, localizeAttachment(message.attachment));
                bubble.appendChild(attachment);
            }
            var meta = document.createElement("div");
            meta.className = "message-meta";
            var metaText = relativeTime(message.date);
            if (message.edited) metaText += " " + translate("telegram.message.edited", "(edited)");
            setText(meta, metaText);
            bubble.appendChild(meta);
            row.appendChild(bubble);
            list.appendChild(row);
        });
        if (scrollToEnd !== false) list.scrollTop = list.scrollHeight;
    }

    function localizeAttachment(value) {
        var text = String(value || "");
        var exact = {
            "[Photo]": ["telegram.message.photo", "[Photo]"],
            "[Sticker]": ["telegram.message.sticker", "[Sticker]"],
            "[Voice message]": ["telegram.message.voice", "[Voice message]"],
            "[Video message]": ["telegram.message.video", "[Video]"],
            "[Video]": ["telegram.message.video", "[Video]"],
            "[Audio]": ["telegram.message.audio", "[Audio]"],
            "[Animation]": ["telegram.message.animation", "[Animation]"],
            "[File]": ["telegram.message.attachment", "[File]"],
            "[Location]": ["telegram.message.location", "[Location]"],
            "[Contact]": ["telegram.message.contact", "[Contact]"],
            "[Poll]": ["telegram.message.poll", "[Poll]"],
            "[Attachment]": ["telegram.message.attachment", "[Attachment]"]
        };
        return exact[text] ? translate(exact[text][0], exact[text][1]) : text;
    }

    async function sendMessage(event) {
        if (event) event.preventDefault();
        if (!currentChat || currentChat.readOnly) return;
        var input = byId("message-input");
        var text = String(input.value || "").trim();
        if (!text) return;
        var button = byId("send-button");
        setBusy(button, true, translate("telegram.state.sending", "Sending..."), translate("telegram.chat.send", "Send"));
        setStatus(translate("telegram.state.sending", "Sending..."));
        try {
            var result = await request("send", { chatRef: currentChat.chatRef, text: text });
            input.value = "";
            if (result.message) mergeMessages([result.message]);
            renderMessages();
            setStatus(translate("telegram.status.sent", "Message sent"));
        } catch (error) {
            setStatus(translate("telegram.status.send_failed", "Message was not sent"));
            showError(error);
        } finally {
            setBusy(button, false, "", translate("telegram.chat.send", "Send"));
        }
    }

    function backToChats() {
        showView("chats-view");
        currentChat = null;
        currentMessages = [];
        loadChats();
    }

    function renderLoading(container, message) {
        container.innerHTML = "";
        var box = document.createElement("div");
        box.className = "loading-state";
        box.appendChild(simpleIcon());
        var text = document.createElement("div");
        setText(text, message);
        box.appendChild(text);
        container.appendChild(box);
    }

    function renderEmpty(container, message) {
        container.innerHTML = "";
        var box = document.createElement("div");
        box.className = "empty-state";
        box.appendChild(simpleIcon());
        var text = document.createElement("div");
        setText(text, message);
        box.appendChild(text);
        container.appendChild(box);
    }

    function simpleIcon() {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 32 32");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "black");
        svg.setAttribute("stroke-width", "2");
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M3 15 L29 4 L23 28 L15 21 L10 25 L10 18 Z M10 18 L23 10 L15 21");
        svg.appendChild(path);
        return svg;
    }

    function relativeTime(value) {
        var timestamp = new Date(value || 0).getTime();
        if (!timestamp) return "";
        var seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (seconds < 60) return translate("telegram.time.now", "now");
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return template("telegram.time.minutes", "${count}m", { count: minutes });
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return template("telegram.time.hours", "${count}h", { count: hours });
        return template("telegram.time.days", "${count}d", { count: Math.floor(hours / 24) });
    }

    function bindEvents() {
        byId("phone-form").addEventListener("submit", startAuth);
        byId("code-form").addEventListener("submit", submitCode);
        byId("email-form").addEventListener("submit", submitEmail);
        byId("email-code-form").addEventListener("submit", submitEmailCode);
        byId("password-form").addEventListener("submit", submitPassword);
        byId("proxy-form").addEventListener("submit", saveProxy);
        byId("auth-proxy-enabled").addEventListener("change", function () { toggleProxyFields("auth"); });
        byId("settings-proxy-enabled").addEventListener("change", function () { toggleProxyFields("settings"); });
        byId("search-form").addEventListener("submit", loadChats);
        byId("composer-form").addEventListener("submit", sendMessage);
    }

    function init() {
        bindEvents();
        initializeFirebase();
    }

    function demoStatus() {
        return {
            authorized: true,
            stage: "connected",
            account: { displayName: "Alex Reader", username: "alex_reader", phone: "+79***42" },
            proxy: { enabled: true, host: "proxy.example.net", port: 443 }
        };
    }

    function demoRequest(action, body) {
        var now = Date.now();
        var demoChats = [
            { chatRef: "demo-family", title: "Family", preview: "Dinner at seven", unreadCount: 3, date: new Date(now - 4 * 60000).toISOString(), type: "group", readOnly: false },
            { chatRef: "demo-reading", title: "E-ink Readers", preview: "New firmware notes are ready", unreadCount: 0, date: new Date(now - 3 * 3600000).toISOString(), type: "group", readOnly: false },
            { chatRef: "demo-news", title: "ReKindle News", preview: "Version 1.0 released", unreadCount: 1, date: new Date(now - 86400000).toISOString(), type: "channel", readOnly: true }
        ];
        if (action === "status") return Promise.resolve(demoStatus());
        if (action === "logout") return Promise.resolve({ authorized: false, stage: "phone" });
        if (action === "chats") {
            var query = String(body.query || "").toLowerCase();
            return Promise.resolve({ items: demoChats.filter(function (chat) {
                return !query || (chat.title + " " + chat.preview).toLowerCase().indexOf(query) !== -1;
            }) });
        }
        if (action === "messages") {
            return Promise.resolve({
                items: [
                    { id: 1, sender: "Maria", text: "The library closes at eight.", outgoing: false, date: new Date(now - 14 * 60000).toISOString(), edited: false },
                    { id: 2, sender: "Alex Reader", text: "Thanks. I will download the book first.", outgoing: true, date: new Date(now - 12 * 60000).toISOString(), edited: false },
                    { id: 3, sender: "Maria", text: "[Photo]", outgoing: false, date: new Date(now - 10 * 60000).toISOString(), edited: false, attachmentType: "photo" }
                ],
                hasMore: false,
                nextOffsetId: 1
            });
        }
        if (action === "send") {
            return Promise.resolve({
                sent: true,
                message: { id: Date.now() % 2000000000, sender: "Alex Reader", text: String(body.text || ""), outgoing: true, date: new Date().toISOString(), edited: false }
            });
        }
        if (action === "read") return Promise.resolve({ read: true });
        if (action === "proxy") return Promise.resolve({ saved: true, proxy: body.enabled === false ? { enabled: false } : { enabled: true, host: body.host, port: Number(body.port) } });
        return Promise.resolve({ authorized: false, stage: "code", delivery: "app" });
    }

    window.telegramApp = {
        closeError: closeError,
        openSetup: openSetup,
        restartAuth: restartAuth,
        loadChats: loadChats,
        backToChats: backToChats,
        refreshMessages: refreshMessages,
        loadOlderMessages: loadOlderMessages,
        openLogout: openLogout,
        closeLogout: closeLogout,
        logOut: logOut,
        openProxySettings: openProxySettings,
        removeProxy: removeProxy
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
