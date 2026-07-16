"use strict";

var crypto = require("node:crypto");
var dns = require("node:dns").promises;
var net = require("node:net");
var teleproto = require("teleproto");

var TelegramClient = teleproto.TelegramClient;
var Api = teleproto.Api;
var StringSession = teleproto.sessions.StringSession;
var computeCheck = teleproto.password.computeCheck;

var SESSION_COLLECTION = "telegram_sessions";
var PENDING_TTL_MS = 15 * 60 * 1000;
var MAX_DIALOGS = 100;
var MAX_MESSAGES = 50;

async function handle(options) {
    options = options || {};
    var action = String(options.action || "");
    var body = options.body || {};
    var uid = String(options.uid || "");
    var firestore = options.firestore;
    var env = options.env || process.env;

    if (!uid || !firestore) throw serviceError(500, "telegram-internal", "Telegram storage is not available.");
    var doc = firestore.collection(SESSION_COLLECTION).doc(uid);

    if (action === "status") return getStatus(doc, uid, env);
    if (action === "start") return startAuthorization(doc, uid, body, env);
    if (action === "email-start") return startEmailVerification(doc, uid, body, env);
    if (action === "email-confirm") return confirmEmailVerification(doc, uid, body, env);
    if (action === "confirm") return confirmAuthorization(doc, uid, body, env);
    if (action === "password") return confirmPassword(doc, uid, body, env);
    if (action === "chats") return withAuthorizedClient(doc, uid, env, function (client, key) {
        return listChats(client, key, body);
    });
    if (action === "messages") return withAuthorizedClient(doc, uid, env, function (client, key) {
        return listMessages(client, key, body);
    });
    if (action === "send") return withAuthorizedClient(doc, uid, env, function (client, key) {
        return sendMessage(client, key, body);
    });
    if (action === "read") return withAuthorizedClient(doc, uid, env, function (client, key) {
        return markRead(client, key, body);
    });
    if (action === "proxy") return updateProxy(doc, uid, body, env);
    if (action === "logout") return logOut(doc, uid, env);
    throw serviceError(404, "telegram-action-not-found", "Telegram action was not found.");
}

async function getStatus(doc, uid, env) {
    var snapshot;
    try {
        snapshot = await doc.get();
    } catch (error) {
        console.error("Telegram session status read failed", {
            name: String(error && error.name || "").slice(0, 80),
            code: String(error && error.code || "").slice(0, 80),
            message: String(error && error.message || "").replace(/\s+/g, " ").slice(0, 300)
        });
        throw serviceError(503, "telegram-storage-unavailable", "Telegram session storage is temporarily unavailable.");
    }
    if (!snapshot.exists) return { authorized: false, stage: "phone" };
    var data = snapshot.data() || {};
    if (data.session) {
        var stored = decryptObject(data.session, getEncryptionKey(env), sessionAad(uid));
        return {
            authorized: true,
            stage: "connected",
            account: sanitizeStoredAccount(data.account),
            proxy: proxySummary(stored.proxy)
        };
    }
    if (!data.pending) return { authorized: false, stage: "phone" };
    var key = getEncryptionKey(env);
    try {
        var pending = decryptObject(data.pending, key, pendingAad(uid));
        if (Number(pending.expiresAt || 0) <= Date.now()) {
            await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
            return { authorized: false, stage: "phone" };
        }
        return {
            authorized: false,
            stage: normalizePendingStage(pending.stage),
            delivery: pending.delivery || "app",
            emailPattern: String(pending.emailPattern || "")
        };
    } catch (error) {
        await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
        return { authorized: false, stage: "phone" };
    }
}

async function startAuthorization(doc, uid, body, env) {
    var phone = validatePhone(body.phone);
    var proxy = await validateProxyConfig(body.proxy);
    var key = getEncryptionKey(env);
    var client = createClient("", env, proxy);
    try {
        await client.connect();
        var result = await client.sendCode(getApiCredentials(env), phone, false);
        var stage = "code";
        if (result.emailRequired) stage = "email-address";
        else if (result.emailCodeSent) stage = "email-code";
        var pending = {
            phone: phone,
            phoneCodeHash: String(result.phoneCodeHash || ""),
            stringSession: client.session.save(),
            stage: stage,
            delivery: result.isCodeViaApp ? "app" : (result.emailCodeSent ? "email" : "other"),
            emailPattern: result.emailOptions && result.emailOptions.emailPattern || "",
            proxy: proxy,
            createdAt: Date.now(),
            expiresAt: Date.now() + PENDING_TTL_MS
        };
        if (!pending.phoneCodeHash || !pending.stringSession) {
            throw serviceError(502, "telegram-auth-failed", "Telegram did not create an authorization session.");
        }
        await doc.set({
            pending: encryptObject(pending, key, pendingAad(uid)),
            updatedAt: Date.now()
        }, { merge: true });
        return {
            authorized: false,
            stage: stage,
            delivery: pending.delivery,
            emailPattern: pending.emailPattern
        };
    } catch (error) {
        throw mapTelegramError(error);
    } finally {
        await disconnectQuietly(client);
    }
}

async function startEmailVerification(doc, uid, body, env) {
    var email = validateEmail(body.email);
    var context = await loadPending(doc, uid, env);
    if (context.pending.stage !== "email-address") {
        throw serviceError(409, "telegram-auth-stage", "Telegram is not waiting for an email address.");
    }
    var client = createClient(context.pending.stringSession, env, context.pending.proxy);
    try {
        await client.connect();
        var result = await client.sendVerifyEmailCode(
            context.pending.phone,
            context.pending.phoneCodeHash,
            email
        );
        context.pending.stage = "email-code";
        context.pending.email = email;
        context.pending.emailPattern = String(result.emailPattern || "");
        context.pending.emailCodeLength = Number(result.length || 0);
        context.pending.stringSession = client.session.save();
        context.pending.expiresAt = Date.now() + PENDING_TTL_MS;
        await savePending(doc, uid, context.pending, env);
        return { authorized: false, stage: "email-code", emailPattern: context.pending.emailPattern };
    } catch (error) {
        throw mapTelegramError(error);
    } finally {
        await disconnectQuietly(client);
    }
}

async function confirmEmailVerification(doc, uid, body, env) {
    var code = validateCode(body.code, "email code");
    var context = await loadPending(doc, uid, env);
    if (context.pending.stage !== "email-code") {
        throw serviceError(409, "telegram-auth-stage", "Telegram is not waiting for an email code.");
    }
    var client = createClient(context.pending.stringSession, env, context.pending.proxy);
    try {
        await client.connect();
        var result = await client.verifyEmail(
            context.pending.phone,
            context.pending.phoneCodeHash,
            { type: "code", code: code }
        );
        var sent = result && result.sentCode;
        if (!(sent instanceof Api.auth.SentCode)) {
            throw serviceError(502, "telegram-auth-failed", "Telegram did not continue the authorization flow.");
        }
        context.pending.phoneCodeHash = String(sent.phoneCodeHash || "");
        context.pending.stage = "code";
        context.pending.delivery = sent.type instanceof Api.auth.SentCodeTypeApp ? "app" : "other";
        context.pending.stringSession = client.session.save();
        context.pending.expiresAt = Date.now() + PENDING_TTL_MS;
        await savePending(doc, uid, context.pending, env);
        return { authorized: false, stage: "code", delivery: context.pending.delivery };
    } catch (error) {
        throw mapTelegramError(error);
    } finally {
        await disconnectQuietly(client);
    }
}

async function confirmAuthorization(doc, uid, body, env) {
    var code = validateCode(body.code, "login code");
    var context = await loadPending(doc, uid, env);
    if (context.pending.stage !== "code") {
        throw serviceError(409, "telegram-auth-stage", "Telegram is not waiting for a login code.");
    }
    var client = createClient(context.pending.stringSession, env, context.pending.proxy);
    try {
        await client.connect();
        var result;
        try {
            result = await client.invoke(new Api.auth.SignIn({
                phoneNumber: context.pending.phone,
                phoneCodeHash: context.pending.phoneCodeHash,
                phoneCode: code
            }));
        } catch (error) {
            if (telegramErrorMessage(error) === "SESSION_PASSWORD_NEEDED") {
                context.pending.stage = "password";
                context.pending.stringSession = client.session.save();
                context.pending.expiresAt = Date.now() + PENDING_TTL_MS;
                await savePending(doc, uid, context.pending, env);
                return { authorized: false, stage: "password" };
            }
            throw error;
        }
        if (result instanceof Api.auth.AuthorizationSignUpRequired) {
            throw serviceError(409, "telegram-registration-required", "Create this Telegram account in the official Telegram app first.");
        }
        return finalizeAuthorization(doc, uid, client, result && result.user, env, context.pending.proxy);
    } catch (error) {
        throw mapTelegramError(error);
    } finally {
        await disconnectQuietly(client);
    }
}

async function confirmPassword(doc, uid, body, env) {
    var password = validatePassword(body.password);
    var context = await loadPending(doc, uid, env);
    if (context.pending.stage !== "password") {
        throw serviceError(409, "telegram-auth-stage", "Telegram is not waiting for a two-step verification password.");
    }
    var client = createClient(context.pending.stringSession, env, context.pending.proxy);
    try {
        await client.connect();
        var passwordInfo = await client.invoke(new Api.account.GetPassword());
        var passwordCheck = await computeCheck(passwordInfo, password);
        var result = await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
        return finalizeAuthorization(doc, uid, client, result && result.user, env, context.pending.proxy);
    } catch (error) {
        throw mapTelegramError(error);
    } finally {
        password = "";
        await disconnectQuietly(client);
    }
}

async function finalizeAuthorization(doc, uid, client, user, env, proxy) {
    var stringSession = client.session.save();
    if (!stringSession || !user) throw serviceError(502, "telegram-auth-failed", "Telegram authorization did not complete.");
    var account = accountFromUser(user);
    await doc.set({
        session: encryptObject({ stringSession: stringSession, proxy: proxy || null }, getEncryptionKey(env), sessionAad(uid)),
        pending: null,
        account: account,
        updatedAt: Date.now()
    }, { merge: true });
    return { authorized: true, stage: "connected", account: account, proxy: proxySummary(proxy) };
}

async function withAuthorizedClient(doc, uid, env, operation) {
    var stored = await loadAuthorized(doc, uid, env);
    var client = createClient(stored.stringSession, env, stored.proxy);
    try {
        await client.connect();
        if (!await client.checkAuthorization()) {
            await doc.delete();
            throw serviceError(409, "telegram-session-expired", "The Telegram session has expired. Sign in again.");
        }
        return await operation(client, getEncryptionKey(env));
    } catch (error) {
        var mapped = mapTelegramError(error);
        if (mapped.code === "telegram-session-expired") await doc.delete().catch(function () {});
        throw mapped;
    } finally {
        await disconnectQuietly(client);
    }
}

async function listChats(client, key, body) {
    var query = String(body.query || "").trim().toLowerCase().slice(0, 100);
    var requestedLimit = clampInteger(body.limit, 1, MAX_DIALOGS, 50);
    var fetchLimit = query ? MAX_DIALOGS : requestedLimit;
    var dialogs = await client.getDialogs({ limit: fetchLimit });
    var items = [];
    for (var i = 0; i < dialogs.length; i++) {
        var mapped = mapDialog(dialogs[i], key);
        if (!mapped) continue;
        if (query && (mapped.title + " " + mapped.preview).toLowerCase().indexOf(query) === -1) continue;
        items.push(mapped);
        if (items.length >= requestedLimit) break;
    }
    return { items: items };
}

async function listMessages(client, key, body) {
    var peer = inputPeerFromRef(body.chatRef, key);
    var limit = clampInteger(body.limit, 1, MAX_MESSAGES, 30);
    var offsetId = body.offsetId === undefined || body.offsetId === null || body.offsetId === ""
        ? 0
        : validateMessageId(body.offsetId);
    var messages = await client.getMessages(peer, { limit: limit, offsetId: offsetId });
    var items = messages.map(mapMessage).filter(Boolean);
    items.sort(function (left, right) { return left.id - right.id; });
    var nextOffsetId = 0;
    for (var i = 0; i < items.length; i++) {
        if (!nextOffsetId || items[i].id < nextOffsetId) nextOffsetId = items[i].id;
    }
    return { items: items, hasMore: messages.length >= limit, nextOffsetId: nextOffsetId || null };
}

async function sendMessage(client, key, body) {
    var peer = inputPeerFromRef(body.chatRef, key);
    var text = String(body.text || "").trim();
    if (!text || text.length > 4096) throw serviceError(400, "telegram-invalid-message", "Message must contain between 1 and 4096 characters.");
    var message = await client.sendMessage(peer, { message: text, parseMode: undefined, linkPreview: true });
    return { message: mapMessage(message), sent: true };
}

async function markRead(client, key, body) {
    var peer = inputPeerFromRef(body.chatRef, key);
    var maxId = body.maxId ? validateMessageId(body.maxId) : 0;
    await client.markAsRead(peer, undefined, { maxId: maxId });
    return { read: true };
}

async function updateProxy(doc, uid, body, env) {
    var stored = await loadAuthorized(doc, uid, env);
    var proxy = body.enabled === false ? null : await validateProxyConfig(body);
    var client = createClient(stored.stringSession, env, proxy);
    try {
        await client.connect();
        if (!await client.checkAuthorization()) {
            throw serviceError(409, "telegram-session-expired", "The Telegram session has expired. Sign in again.");
        }
        stored.proxy = proxy;
        await doc.set({
            session: encryptObject(stored, getEncryptionKey(env), sessionAad(uid)),
            updatedAt: Date.now()
        }, { merge: true });
        return { saved: true, proxy: proxySummary(proxy) };
    } catch (error) {
        throw mapTelegramError(error);
    } finally {
        await disconnectQuietly(client);
    }
}

async function logOut(doc, uid, env) {
    var snapshot = await doc.get();
    if (!snapshot.exists) return { authorized: false };
    var data = snapshot.data() || {};
    var client = null;
    try {
        if (data.session) {
            var stored = decryptObject(data.session, getEncryptionKey(env), sessionAad(uid));
            client = createClient(stored.stringSession, env, stored.proxy);
            await client.connect();
            await client.logOut();
        }
    } catch (error) {
        var mapped = mapTelegramError(error);
        if (mapped.code !== "telegram-session-expired") {
            console.warn("Telegram server-side logout failed", { uid: uid, code: mapped.code });
        }
    } finally {
        await disconnectQuietly(client);
        await doc.delete();
    }
    return { authorized: false, stage: "phone" };
}

async function loadPending(doc, uid, env) {
    var snapshot = await doc.get();
    var data = snapshot.exists ? snapshot.data() || {} : {};
    if (!data.pending) throw serviceError(409, "telegram-auth-expired", "The Telegram authorization attempt has expired. Start again.");
    var pending;
    try {
        pending = decryptObject(data.pending, getEncryptionKey(env), pendingAad(uid));
    } catch (error) {
        throw serviceError(409, "telegram-auth-expired", "The Telegram authorization attempt has expired. Start again.");
    }
    if (Number(pending.expiresAt || 0) <= Date.now()) {
        await doc.set({ pending: null, updatedAt: Date.now() }, { merge: true });
        throw serviceError(409, "telegram-auth-expired", "The Telegram authorization attempt has expired. Start again.");
    }
    return { pending: pending, data: data };
}

async function savePending(doc, uid, pending, env) {
    await doc.set({
        pending: encryptObject(pending, getEncryptionKey(env), pendingAad(uid)),
        updatedAt: Date.now()
    }, { merge: true });
}

async function loadAuthorized(doc, uid, env) {
    var snapshot = await doc.get();
    var data = snapshot.exists ? snapshot.data() || {} : {};
    if (!data.session) throw serviceError(409, "telegram-not-connected", "Connect a Telegram account first.");
    try {
        return decryptObject(data.session, getEncryptionKey(env), sessionAad(uid));
    } catch (error) {
        throw serviceError(409, "telegram-session-expired", "The Telegram session cannot be restored. Sign in again.");
    }
}

function createClient(stringSession, env, proxy) {
    var credentials = getApiCredentials(env);
    var client = new TelegramClient(new StringSession(String(stringSession || "")), credentials.apiId, credentials.apiHash, {
        connectionRetries: 1,
        reconnectRetries: 0,
        requestRetries: 1,
        retryDelay: 250,
        autoReconnect: false,
        floodSleepThreshold: 0,
        timeout: 10,
        deviceModel: "ReKindle Server",
        systemVersion: "Yandex Cloud",
        appVersion: "1.0",
        langCode: "en",
        systemLangCode: "en",
        proxy: proxy ? {
            MTProxy: true,
            ip: proxy.ip,
            port: proxy.port,
            secret: proxy.secret,
            timeout: 8
        } : undefined
    });
    client.setLogLevel("none");
    return client;
}

async function validateProxyConfig(input) {
    if (!input || input.enabled !== true) return null;
    var host = String(input.host || "").trim().toLowerCase();
    var port = Number(input.port || 0);
    if (!host || host.length > 253 || host === "localhost" || /[\s\/@]/.test(host) || host.slice(-6) === ".local") {
        throw serviceError(400, "telegram-proxy-host-invalid", "Enter a valid public MTProxy host.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw serviceError(400, "telegram-proxy-port-invalid", "Enter a valid MTProxy port.");
    }
    var secret = validateProxySecret(input.secret);
    var addresses;
    if (net.isIP(host)) {
        addresses = [{ address: host }];
    } else {
        if (!/^[a-z0-9.-]+$/.test(host) || host.indexOf("..") !== -1 || host.charAt(0) === "." || host.charAt(host.length - 1) === ".") {
            throw serviceError(400, "telegram-proxy-host-invalid", "Enter a valid public MTProxy host.");
        }
        try {
            addresses = await dns.lookup(host, { all: true, verbatim: true });
        } catch (error) {
            throw serviceError(400, "telegram-proxy-unresolved", "The MTProxy host could not be resolved.");
        }
    }
    if (!addresses.length || addresses.some(function (entry) { return isPrivateAddress(entry.address); })) {
        throw serviceError(400, "telegram-proxy-private", "Private or local MTProxy addresses are not allowed.");
    }
    return {
        host: host,
        ip: String(addresses[0].address),
        port: port,
        secret: secret
    };
}

function validateProxySecret(value) {
    var input = String(value || "").trim();
    if (!input || input.length > 1024) throw serviceError(400, "telegram-proxy-secret-invalid", "Enter a valid MTProxy secret.");
    var raw;
    if (/^[0-9a-fA-F]+$/.test(input) && input.length % 2 === 0) {
        raw = Buffer.from(input, "hex");
    } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(input)) {
        try {
            raw = Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        } catch (error) {
            raw = Buffer.alloc(0);
        }
    } else {
        raw = Buffer.alloc(0);
    }
    var valid = raw.length === 16 ||
        (raw.length === 17 && raw[0] === 0xdd) ||
        (raw.length > 17 && raw.length <= 255 && raw[0] === 0xee && validFakeTlsDomain(raw.subarray(17).toString("utf8")));
    if (!valid) throw serviceError(400, "telegram-proxy-secret-invalid", "Enter a valid MTProxy secret.");
    return raw.toString("hex");
}

function validFakeTlsDomain(value) {
    return Boolean(value && value.length <= 200 && /^[a-zA-Z0-9.-]+$/.test(value) && value.indexOf("..") === -1);
}

function isPrivateAddress(address) {
    var value = String(address || "").toLowerCase();
    if (value.indexOf("::ffff:") === 0) value = value.slice(7);
    if (net.isIP(value) === 4) {
        var parts = value.split(".").map(Number);
        return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
            (parts[0] === 169 && parts[1] === 254) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
            (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
            (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
            (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
            (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
            (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224;
    }
    if (net.isIP(value) === 6) {
        return value === "::" || value === "::1" || value.indexOf("fe8") === 0 ||
            value.indexOf("fe9") === 0 || value.indexOf("fea") === 0 || value.indexOf("feb") === 0 ||
            value.indexOf("fc") === 0 || value.indexOf("fd") === 0 || value.indexOf("ff") === 0 ||
            value.indexOf("2001:db8") === 0;
    }
    return true;
}

function proxySummary(proxy) {
    if (!proxy) return { enabled: false };
    return {
        enabled: true,
        host: String(proxy.host || proxy.ip || "").slice(0, 253),
        port: Number(proxy.port || 0)
    };
}

function getApiCredentials(env) {
    var apiId = Number(env.TELEGRAM_API_ID || 0);
    var apiHash = String(env.TELEGRAM_API_HASH || "").trim();
    if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-fA-F0-9]{32}$/.test(apiHash)) {
        throw serviceError(503, "telegram-configuration", "Telegram API credentials are not configured.");
    }
    return { apiId: apiId, apiHash: apiHash };
}

function getEncryptionKey(env) {
    var raw = String(env.TELEGRAM_SESSION_ENCRYPTION_KEY || "").trim();
    var key;
    try {
        key = Buffer.from(raw, "base64");
    } catch (error) {
        key = Buffer.alloc(0);
    }
    if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
        throw serviceError(503, "telegram-configuration", "Telegram session encryption is not configured.");
    }
    return key;
}

function encryptObject(value, key, aad) {
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(String(aad), "utf8"));
    var ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return {
        version: 1,
        iv: iv.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
    };
}

function decryptObject(value, key, aad) {
    if (!value || value.version !== 1) throw new Error("Unsupported encrypted value.");
    var decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(value.iv || ""), "base64"));
    decipher.setAAD(Buffer.from(String(aad), "utf8"));
    decipher.setAuthTag(Buffer.from(String(value.tag || ""), "base64"));
    var plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(value.ciphertext || ""), "base64")),
        decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext);
}

function mapDialog(dialog, key) {
    if (!dialog || !dialog.inputEntity) return null;
    var chatRef;
    try {
        chatRef = signPeerRef(dialog.inputEntity, key);
    } catch (error) {
        return null;
    }
    var entity = dialog.entity || {};
    var title = String(dialog.title || dialog.name || entityTitle(entity) || "Telegram").slice(0, 200);
    var message = dialog.message;
    return {
        chatRef: chatRef,
        title: title,
        preview: messagePreview(message),
        unreadCount: Math.max(0, Number(dialog.unreadCount || 0)),
        date: normalizeDate(dialog.date || message && message.date),
        pinned: dialog.pinned === true,
        type: dialog.isChannel ? (entity.broadcast ? "channel" : "group") : (dialog.isGroup ? "group" : "single"),
        readOnly: dialog.isChannel && entity.broadcast === true && !entity.creator && !entity.adminRights
    };
}

function mapMessage(message) {
    if (!message || !message.id) return null;
    var sender = message.sender || {};
    var attachment = attachmentDescription(message);
    var text = String(message.message || message.text || "");
    return {
        id: Number(message.id),
        text: text || attachment.text,
        attachment: text && attachment.text ? attachment.text : "",
        sender: entityTitle(sender) || String(message.postAuthor || "Telegram"),
        senderId: valueToString(message.senderId),
        outgoing: message.out === true,
        date: normalizeDate(message.date),
        edited: Boolean(message.editDate),
        attachmentType: attachment.type
    };
}

function attachmentDescription(message) {
    if (!message || !message.media) return { type: "", text: "" };
    if (message.photo) return { type: "photo", text: "[Photo]" };
    if (message.sticker) return { type: "sticker", text: "[Sticker]" };
    if (message.voice) return { type: "voice", text: "[Voice message]" };
    if (message.videoNote) return { type: "video", text: "[Video message]" };
    if (message.video) return { type: "video", text: "[Video]" };
    if (message.audio) return { type: "audio", text: "[Audio]" };
    if (message.gif) return { type: "animation", text: "[Animation]" };
    if (message.document) {
        var name = documentFileName(message.document);
        return { type: "file", text: name ? "[File: " + name + "]" : "[File]" };
    }
    if (message.geo) return { type: "location", text: "[Location]" };
    if (message.contact) return { type: "contact", text: "[Contact]" };
    if (message.poll) return { type: "poll", text: "[Poll]" };
    return { type: "attachment", text: "[Attachment]" };
}

function documentFileName(document) {
    var attributes = document && document.attributes || [];
    for (var i = 0; i < attributes.length; i++) {
        if (attributes[i] instanceof Api.DocumentAttributeFilename) return String(attributes[i].fileName || "").slice(0, 160);
    }
    return "";
}

function messagePreview(message) {
    if (!message) return "";
    var text = String(message.message || message.text || "").replace(/\s+/g, " ").trim();
    if (!text) text = attachmentDescription(message).text;
    return text.slice(0, 240);
}

function entityTitle(entity) {
    if (!entity) return "";
    var title = String(entity.title || "").trim();
    if (title) return title;
    var name = (String(entity.firstName || "") + " " + String(entity.lastName || "")).trim();
    if (name) return name;
    if (entity.username) return "@" + String(entity.username);
    return "";
}

function accountFromUser(user) {
    return {
        id: valueToString(user.id),
        displayName: entityTitle(user) || "Telegram",
        username: user.username ? String(user.username).slice(0, 64) : "",
        phone: maskPhone(user.phone)
    };
}

function sanitizeStoredAccount(account) {
    account = account || {};
    return {
        id: String(account.id || ""),
        displayName: String(account.displayName || "Telegram").slice(0, 200),
        username: String(account.username || "").slice(0, 64),
        phone: String(account.phone || "").slice(0, 32)
    };
}

function maskPhone(value) {
    var phone = String(value || "").replace(/\D/g, "");
    if (!phone) return "";
    if (phone.length <= 4) return "+" + phone;
    return "+" + phone.slice(0, 2) + "***" + phone.slice(-2);
}

function signPeerRef(inputPeer, key) {
    var payload;
    if (inputPeer instanceof Api.InputPeerSelf) {
        payload = { version: 1, type: "self" };
    } else if (inputPeer instanceof Api.InputPeerUser) {
        payload = { version: 1, type: "user", id: valueToString(inputPeer.userId), accessHash: valueToString(inputPeer.accessHash) };
    } else if (inputPeer instanceof Api.InputPeerChannel) {
        payload = { version: 1, type: "channel", id: valueToString(inputPeer.channelId), accessHash: valueToString(inputPeer.accessHash) };
    } else if (inputPeer instanceof Api.InputPeerChat) {
        payload = { version: 1, type: "chat", id: valueToString(inputPeer.chatId) };
    } else {
        throw new Error("Unsupported Telegram peer.");
    }
    var encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    var signature = crypto.createHmac("sha256", deriveChatRefKey(key)).update(encoded).digest("base64url");
    return encoded + "." + signature;
}

function inputPeerFromRef(value, key) {
    var parts = String(value || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
    var expected = crypto.createHmac("sha256", deriveChatRefKey(key)).update(parts[0]).digest();
    var actual;
    try {
        actual = Buffer.from(parts[1], "base64url");
    } catch (error) {
        actual = Buffer.alloc(0);
    }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
    }
    var payload;
    try {
        payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch (error) {
        throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
    }
    if (!payload || payload.version !== 1) throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
    if (payload.type === "self") return new Api.InputPeerSelf();
    if (!/^\d{1,20}$/.test(String(payload.id || ""))) throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
    if (payload.type === "chat") return new Api.InputPeerChat({ chatId: payload.id });
    if (!/^-?\d{1,20}$/.test(String(payload.accessHash || ""))) throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
    if (payload.type === "user") return new Api.InputPeerUser({ userId: payload.id, accessHash: payload.accessHash });
    if (payload.type === "channel") return new Api.InputPeerChannel({ channelId: payload.id, accessHash: payload.accessHash });
    throw serviceError(400, "telegram-invalid-chat", "Invalid Telegram chat reference.");
}

function deriveChatRefKey(key) {
    return crypto.createHmac("sha256", key).update("rekindle-telegram-chat-ref-v1").digest();
}

function validatePhone(value) {
    var phone = String(value || "").replace(/[\s()\-.]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw serviceError(400, "telegram-phone-invalid", "Enter a phone number in international format, for example +12025550123.");
    return phone;
}

function validateEmail(value) {
    var email = String(value || "").trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw serviceError(400, "telegram-email-invalid", "Enter a valid email address.");
    return email;
}

function validateCode(value, label) {
    var code = String(value || "").replace(/[\s-]/g, "");
    if (!/^\d{4,10}$/.test(code)) throw serviceError(400, "telegram-code-invalid", "Enter the " + label + ".");
    return code;
}

function validatePassword(value) {
    var password = String(value || "");
    if (!password || password.length > 256) throw serviceError(400, "telegram-password-invalid", "Enter the Telegram two-step verification password.");
    return password;
}

function validateMessageId(value) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 2147483647) throw serviceError(400, "telegram-invalid-message", "Invalid Telegram message ID.");
    return number;
}

function clampInteger(value, min, max, fallback) {
    var number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function normalizeDate(value) {
    var number = value instanceof Date ? value.getTime() : Number(value || 0);
    if (number > 0 && number < 100000000000) number *= 1000;
    if (!number || !Number.isFinite(number)) return "";
    return new Date(number).toISOString();
}

function normalizePendingStage(value) {
    var allowed = { code: true, password: true, "email-address": true, "email-code": true };
    return allowed[value] ? value : "phone";
}

function valueToString(value) {
    if (value === undefined || value === null) return "";
    return typeof value.toString === "function" ? value.toString() : String(value);
}

function sessionAad(uid) {
    return "rekindle-telegram-session-v1:" + uid;
}

function pendingAad(uid) {
    return "rekindle-telegram-pending-v1:" + uid;
}

function telegramErrorMessage(error) {
    return String(error && (error.errorMessage || error.code || error.message) || "").toUpperCase();
}

function mapTelegramError(error) {
    if (error && error.status && error.code) return error;
    var message = telegramErrorMessage(error);
    var flood = message.match(/FLOOD_WAIT_?(\d+)/);
    if (flood) {
        var rate = serviceError(429, "telegram-rate-limited", "Telegram temporarily limited authorization or requests. Try again later.");
        rate.retryAfter = Number(flood[1] || 0);
        return rate;
    }
    if (message.indexOf("PHONE_NUMBER_INVALID") !== -1) return serviceError(400, "telegram-phone-invalid", "Telegram rejected this phone number.");
    if (message.indexOf("PHONE_CODE_INVALID") !== -1 || message.indexOf("EMAIL_VERIFY_EXPIRED") !== -1) return serviceError(400, "telegram-code-invalid", "The Telegram code is invalid.");
    if (message.indexOf("PHONE_CODE_EXPIRED") !== -1) return serviceError(409, "telegram-auth-expired", "The Telegram code has expired. Start again.");
    if (message.indexOf("PASSWORD_HASH_INVALID") !== -1) return serviceError(400, "telegram-password-invalid", "The Telegram two-step verification password is incorrect.");
    if (message.indexOf("AUTH_KEY_UNREGISTERED") !== -1 || message.indexOf("SESSION_REVOKED") !== -1 || message.indexOf("USER_DEACTIVATED") !== -1) {
        return serviceError(409, "telegram-session-expired", "The Telegram session has expired. Sign in again.");
    }
    if (message.indexOf("API_ID_INVALID") !== -1 || message.indexOf("TELEGRAM API CREDENTIALS") !== -1 || message.indexOf("TELEGRAM SESSION ENCRYPTION") !== -1) {
        return serviceError(503, "telegram-configuration", "Telegram service credentials are not configured correctly.");
    }
    if (message.indexOf("RECAPTCHA") !== -1) return serviceError(409, "telegram-recaptcha-required", "Telegram requires an additional verification step that this Kindle client cannot display yet.");
    if (message.indexOf("TIMEOUT") !== -1 || message.indexOf("CONNECTION") !== -1 || message.indexOf("ECONN") !== -1) {
        return serviceError(504, "telegram-unavailable", "Telegram did not respond in time.");
    }
    return serviceError(502, "telegram-upstream", "Telegram could not complete the request.");
}

async function disconnectQuietly(client) {
    if (!client) return;
    try {
        await client.disconnect();
    } catch (error) {}
}

function serviceError(status, code, message) {
    var error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

module.exports = {
    handle: handle,
    testHooks: {
        encryptObject: encryptObject,
        decryptObject: decryptObject,
        signPeerRef: signPeerRef,
        inputPeerFromRef: inputPeerFromRef,
        getEncryptionKey: getEncryptionKey,
        mapTelegramError: mapTelegramError,
        validatePhone: validatePhone,
        validateProxySecret: validateProxySecret,
        isPrivateAddress: isPrivateAddress,
        mapMessage: mapMessage,
        sessionAad: sessionAad
    }
};
