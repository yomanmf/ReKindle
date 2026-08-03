"use strict";

var crypto = require("node:crypto");
var DOMParser = require("linkedom").DOMParser;

var SESSION_COLLECTION = "exchange_calendar_sessions";
var EWS_URL = "https://mailsec.o3t.ru/EWS/Exchange.asmx";
var REQUEST_TIMEOUT_MS = 20000;
var MAX_EVENTS = 250;
var MAX_RANGE_MS = 370 * 24 * 60 * 60 * 1000;

async function handle(options) {
    options = options || {};
    var action = String(options.action || "");
    var body = options.body || {};
    var uid = String(options.uid || "");
    var env = options.env || process.env;
    var request = options.fetch || fetch;
    var doc = options.sessionDocument;

    if (!doc && options.firestore) doc = options.firestore.collection(SESSION_COLLECTION).doc(uid);
    if (!uid || !doc) throw serviceError(500, "exchange-calendar-internal", "Exchange Calendar storage is not available.");

    if (action === "status") return getStatus(doc, uid, env);
    if (action === "connect") return connect(doc, uid, body, env, request);
    if (action === "events") return withCredentials(doc, uid, env, function (credentials) {
        var range = validateRange(body.start, body.end);
        return listEvents(credentials, range.start, range.end, request);
    });
    if (action === "disconnect") {
        await doc.delete();
        return { connected: false };
    }
    throw serviceError(404, "exchange-calendar-action-not-found", "Exchange Calendar action was not found.");
}

async function getStatus(doc, uid, env) {
    var snapshot = await readSessionDocument(doc);
    if (!snapshot.exists) return { connected: false };
    try {
        var credentials = decryptObject(snapshot.data().credentials, getEncryptionKey(env), sessionAad(uid));
        return { connected: true, email: validateEmail(credentials.email) };
    } catch (error) {
        await doc.delete();
        return { connected: false };
    }
}

async function connect(doc, uid, body, env, request) {
    var credentials = {
        email: validateEmail(body.email),
        password: validatePassword(body.password)
    };
    await validateCredentials(credentials, request);
    await doc.set({
        credentials: encryptObject(credentials, getEncryptionKey(env), sessionAad(uid)),
        connectedAt: Date.now(),
        updatedAt: Date.now()
    });
    return { connected: true, email: credentials.email };
}

async function withCredentials(doc, uid, env, operation) {
    var snapshot = await readSessionDocument(doc);
    if (!snapshot.exists) throw serviceError(401, "exchange-calendar-not-connected", "Connect Exchange Calendar first.");
    var credentials;
    try {
        credentials = decryptObject(snapshot.data().credentials, getEncryptionKey(env), sessionAad(uid));
        credentials.email = validateEmail(credentials.email);
        credentials.password = validatePassword(credentials.password);
    } catch (error) {
        await doc.delete();
        throw serviceError(409, "exchange-calendar-session-invalid", "The Exchange Calendar session is no longer valid. Connect again.");
    }
    return operation(credentials);
}

async function validateCredentials(credentials, request) {
    var body = soapEnvelope(
        '<m:GetFolder>' +
        '<m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape>' +
        '<m:FolderIds><t:DistinguishedFolderId Id="calendar"/></m:FolderIds>' +
        '</m:GetFolder>'
    );
    var xml = await ewsRequest(credentials, body, request);
    ensureEwsSuccess(xml);
}

async function listEvents(credentials, start, end, request) {
    var findBody = soapEnvelope(
        '<m:FindItem Traversal="Shallow">' +
        '<m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>' +
        '<m:CalendarView MaxEntriesReturned="' + MAX_EVENTS + '" StartDate="' + escapeXml(start) + '" EndDate="' + escapeXml(end) + '"/>' +
        '<m:ParentFolderIds><t:DistinguishedFolderId Id="calendar"/></m:ParentFolderIds>' +
        '</m:FindItem>'
    );
    var findXml = await ewsRequest(credentials, findBody, request);
    ensureEwsSuccess(findXml);
    var ids = elements(findXml, "ItemId").map(function (item) {
        return String(item.getAttribute("Id") || "");
    }).filter(Boolean).slice(0, MAX_EVENTS);
    if (!ids.length) return { events: [] };

    var itemIds = ids.map(function (id) {
        return '<t:ItemId Id="' + escapeXml(id) + '"/>';
    }).join("");
    var getBody = soapEnvelope(
        '<m:GetItem>' +
        '<m:ItemShape>' +
        '<t:BaseShape>IdOnly</t:BaseShape>' +
        '<t:BodyType>Text</t:BodyType>' +
        '<t:AdditionalProperties>' +
        '<t:FieldURI FieldURI="item:Subject"/>' +
        '<t:FieldURI FieldURI="item:Body"/>' +
        '<t:FieldURI FieldURI="item:Sensitivity"/>' +
        '<t:FieldURI FieldURI="calendar:Start"/>' +
        '<t:FieldURI FieldURI="calendar:End"/>' +
        '<t:FieldURI FieldURI="calendar:IsAllDayEvent"/>' +
        '<t:FieldURI FieldURI="calendar:Location"/>' +
        '<t:FieldURI FieldURI="calendar:Organizer"/>' +
        '</t:AdditionalProperties>' +
        '</m:ItemShape>' +
        '<m:ItemIds>' + itemIds + '</m:ItemIds>' +
        '</m:GetItem>'
    );
    var getXml = await ewsRequest(credentials, getBody, request);
    ensureEwsSuccess(getXml);
    var events = elements(getXml, "CalendarItem").map(sanitizeEvent).filter(Boolean);
    events.sort(function (left, right) { return left.start.localeCompare(right.start); });
    return { events: events };
}

function sanitizeEvent(item) {
    var idElement = firstElement(item, "ItemId");
    var id = idElement && String(idElement.getAttribute("Id") || "");
    var start = safeIso(elementText(item, "Start"));
    var end = safeIso(elementText(item, "End"));
    if (!id || !start || !end) return null;
    var organizer = firstElement(item, "Organizer");
    return {
        id: id.slice(0, 2048),
        title: cleanText(elementText(item, "Subject") || "Untitled event", 500),
        start: start,
        end: end,
        isAllDay: elementText(item, "IsAllDayEvent").toLowerCase() === "true",
        location: cleanText(elementText(item, "Location"), 1000),
        organizer: cleanText(organizer ? elementText(organizer, "Name") || elementText(organizer, "EmailAddress") : "", 500),
        description: cleanText(elementText(item, "Body"), 20000),
        sensitivity: validateSensitivity(elementText(item, "Sensitivity"))
    };
}

async function ewsRequest(credentials, soapBody, request) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    var response;
    try {
        response = await request(EWS_URL, {
            method: "POST",
            headers: {
                "Accept": "text/xml",
                "Authorization": "Basic " + Buffer.from(credentials.email + ":" + credentials.password, "utf8").toString("base64"),
                "Content-Type": "text/xml; charset=utf-8",
                "X-AnchorMailbox": credentials.email
            },
            body: soapBody,
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === "AbortError") throw serviceError(504, "exchange-calendar-timeout", "Exchange did not respond in time.");
        throw serviceError(502, "exchange-calendar-unavailable", "Exchange Calendar is unavailable.");
    } finally {
        clearTimeout(timer);
    }
    var text = await response.text();
    if (response.status === 401 || response.status === 403) {
        throw serviceError(401, "exchange-calendar-auth", "Exchange rejected the email or app password.");
    }
    if (response.status === 429) throw serviceError(429, "exchange-calendar-rate-limited", "Exchange is receiving too many requests.");
    if (!response.ok) throw serviceError(response.status >= 500 ? 503 : 400, "exchange-calendar-request", "Exchange rejected the calendar request.");
    if (!text || text.length > 5 * 1024 * 1024) throw serviceError(502, "exchange-calendar-response", "Exchange returned an invalid response.");
    return parseXml(text);
}

function soapEnvelope(body) {
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">' +
        '<s:Header><t:RequestServerVersion Version="Exchange2013"/></s:Header>' +
        '<s:Body>' + body + '</s:Body></s:Envelope>';
}

function parseXml(value) {
    var document = new DOMParser().parseFromString(String(value || ""), "text/xml");
    if (!document || !document.documentElement) throw serviceError(502, "exchange-calendar-response", "Exchange returned invalid XML.");
    return document;
}

function ensureEwsSuccess(document) {
    var fault = firstElement(document, "Fault");
    if (fault) throw serviceError(502, "exchange-calendar-fault", cleanText(elementText(fault, "faultstring") || "Exchange returned a SOAP fault.", 300));
    var messages = elements(document, "ResponseMessage").concat(elements(document, "GetFolderResponseMessage"))
        .concat(elements(document, "FindItemResponseMessage")).concat(elements(document, "GetItemResponseMessage"));
    for (var i = 0; i < messages.length; i++) {
        var responseClass = String(messages[i].getAttribute("ResponseClass") || "");
        var responseCode = elementText(messages[i], "ResponseCode");
        if (responseClass && responseClass !== "Success") {
            throw serviceError(400, "exchange-calendar-provider", cleanText(elementText(messages[i], "MessageText") || responseCode || "Exchange rejected the request.", 300));
        }
    }
}

function elements(root, name) {
    if (!root || !root.querySelectorAll) return [];
    return Array.from(root.querySelectorAll("*")).filter(function (element) {
        return localName(element) === name;
    });
}

function firstElement(root, name) {
    var matches = elements(root, name);
    return matches.length ? matches[0] : null;
}

function elementText(root, name) {
    var element = firstElement(root, name);
    return element ? String(element.textContent || "") : "";
}

function localName(element) {
    var name = String(element.localName || element.tagName || "");
    return name.slice(name.lastIndexOf(":") + 1);
}

function validateRange(startValue, endValue) {
    var start = new Date(String(startValue || ""));
    var end = new Date(String(endValue || ""));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start || end - start > MAX_RANGE_MS) {
        throw serviceError(400, "exchange-calendar-range", "Enter a valid calendar range of at most 370 days.");
    }
    return { start: start.toISOString(), end: end.toISOString() };
}

function validateEmail(value) {
    var email = String(value || "").trim().toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ozon\.ru$/.test(email) || email.length > 254) {
        throw serviceError(400, "exchange-calendar-email", "Enter your @ozon.ru email address.");
    }
    return email;
}

function validatePassword(value) {
    var password = String(value || "");
    if (password.length < 8 || password.length > 512 || /[\u0000-\u001f\u007f]/.test(password)) {
        throw serviceError(400, "exchange-calendar-password", "Enter a valid Exchange app password.");
    }
    return password;
}

function validateSensitivity(value) {
    var sensitivity = String(value || "Normal");
    return ["Normal", "Personal", "Private", "Confidential"].indexOf(sensitivity) === -1 ? "Normal" : sensitivity;
}

function safeIso(value) {
    var date = new Date(String(value || ""));
    return isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanText(value, maxLength) {
    return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function escapeXml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function getEncryptionKey(env) {
    var raw = String(env.EXCHANGE_CALENDAR_ENCRYPTION_KEY || env.MICROSOFT_TODO_SESSION_ENCRYPTION_KEY || "").trim();
    var key;
    try {
        key = Buffer.from(raw, "base64");
    } catch (error) {
        key = Buffer.alloc(0);
    }
    if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
        throw serviceError(503, "exchange-calendar-configuration", "Exchange Calendar encryption is not configured.");
    }
    return key;
}

function encryptObject(value, key, aad) {
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    var ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { version: 1, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptObject(value, key, aad) {
    if (!value || value.version !== 1) throw new Error("Unsupported encrypted value.");
    var decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(value.iv || ""), "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(String(value.tag || ""), "base64"));
    var plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(value.ciphertext || ""), "base64")),
        decipher.final()
    ]);
    return JSON.parse(plaintext.toString("utf8"));
}

async function readSessionDocument(doc) {
    try {
        return await doc.get();
    } catch (error) {
        try {
            return await doc.get();
        } catch (retryError) {
            throw serviceError(503, "exchange-calendar-storage", "Exchange Calendar storage is unavailable.");
        }
    }
}

function sessionAad(uid) {
    return "rekindle:exchange-calendar:session:" + uid;
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
        cleanText: cleanText,
        decryptObject: decryptObject,
        encryptObject: encryptObject,
        escapeXml: escapeXml,
        parseXml: parseXml,
        sanitizeEvent: sanitizeEvent,
        soapEnvelope: soapEnvelope,
        validateEmail: validateEmail,
        validatePassword: validatePassword,
        validateRange: validateRange
    }
};
