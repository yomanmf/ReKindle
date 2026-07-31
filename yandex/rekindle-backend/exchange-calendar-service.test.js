"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var service = require("./exchange-calendar-service");

var key = Buffer.alloc(32, 9).toString("base64");
var successFolder = soap(
    '<m:GetFolderResponse><m:ResponseMessages><m:GetFolderResponseMessage ResponseClass="Success">' +
    '<m:ResponseCode>NoError</m:ResponseCode><m:Folders><t:CalendarFolder><t:FolderId Id="calendar-id"/></t:CalendarFolder></m:Folders>' +
    '</m:GetFolderResponseMessage></m:ResponseMessages></m:GetFolderResponse>'
);

test("Exchange credentials are encrypted, UID-bound, and never returned", async function () {
    var store = fakeFirestore();
    var authorization = "";
    var result = await service.handle({
        action: "connect",
        body: { email: "User@ozon.ru", password: "CODE:secret-password" },
        uid: "uid-one",
        firestore: store.firestore,
        env: { EXCHANGE_CALENDAR_ENCRYPTION_KEY: key },
        fetch: async function (url, options) {
            assert.equal(url, "https://mailsec.o3t.ru/EWS/Exchange.asmx");
            authorization = options.headers.Authorization;
            return xmlResponse(200, successFolder);
        }
    });

    assert.deepEqual(result, { connected: true, email: "user@ozon.ru" });
    assert.equal(Buffer.from(authorization.slice(6), "base64").toString("utf8"), "user@ozon.ru:CODE:secret-password");
    assert.doesNotMatch(JSON.stringify(store.value), /secret-password|CODE:/);
    assert.deepEqual(await service.handle({
        action: "status",
        uid: "uid-one",
        firestore: store.firestore,
        env: { EXCHANGE_CALENDAR_ENCRYPTION_KEY: key }
    }), { connected: true, email: "user@ozon.ru" });

    var encrypted = store.value.credentials;
    assert.throws(function () {
        service.testHooks.decryptObject(encrypted, Buffer.from(key, "base64"), "rekindle:exchange-calendar:session:uid-two");
    });
});

test("Exchange Calendar expands a range and returns safe event details", async function () {
    var store = fakeFirestore();
    var queue = [
        successFolder,
        soap('<m:FindItemResponse><m:ResponseMessages><m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:RootFolder><t:Items>' +
            '<t:CalendarItem><t:ItemId Id="event-one"/></t:CalendarItem>' +
            '</t:Items></m:RootFolder></m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>'),
        soap('<m:GetItemResponse><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items>' +
            '<t:CalendarItem><t:ItemId Id="event-one"/><t:Subject>Release &amp; review</t:Subject>' +
            '<t:Body BodyType="Text">Agenda\u0001 text</t:Body><t:Sensitivity>Private</t:Sensitivity>' +
            '<t:Start>2026-07-31T09:00:00Z</t:Start><t:End>2026-07-31T10:00:00Z</t:End>' +
            '<t:IsAllDayEvent>false</t:IsAllDayEvent><t:Location>Room 2</t:Location>' +
            '<t:Organizer><t:Mailbox><t:Name>Alice</t:Name><t:EmailAddress>alice@ozon.ru</t:EmailAddress></t:Mailbox></t:Organizer>' +
            '</t:CalendarItem></m:Items></m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse>')
    ];
    var request = async function () { return xmlResponse(200, queue.shift()); };

    await service.handle({
        action: "connect",
        body: { email: "user@ozon.ru", password: "CODE:secret-password" },
        uid: "uid-one",
        firestore: store.firestore,
        env: { EXCHANGE_CALENDAR_ENCRYPTION_KEY: key },
        fetch: request
    });
    var result = await service.handle({
        action: "events",
        body: { start: "2026-07-01T00:00:00Z", end: "2026-08-01T00:00:00Z" },
        uid: "uid-one",
        firestore: store.firestore,
        env: { EXCHANGE_CALENDAR_ENCRYPTION_KEY: key },
        fetch: request
    });

    assert.deepEqual(result.events, [{
        id: "event-one",
        title: "Release & review",
        start: "2026-07-31T09:00:00.000Z",
        end: "2026-07-31T10:00:00.000Z",
        isAllDay: false,
        location: "Room 2",
        organizer: "Alice",
        description: "Agenda  text",
        sensitivity: "Private"
    }]);
});

test("Exchange Calendar rejects invalid accounts, passwords, and ranges", function () {
    assert.throws(function () { service.testHooks.validateEmail("user@example.com"); });
    assert.throws(function () { service.testHooks.validatePassword("short"); });
    assert.throws(function () { service.testHooks.validateRange("2026-01-01", "2028-01-01"); });
    assert.equal(service.testHooks.escapeXml('a<&"\''), "a&lt;&amp;&quot;&apos;");
});

function soap(body) {
    return '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Body>' + body + '</s:Body></s:Envelope>';
}

function xmlResponse(status, body) {
    return {
        status: status,
        ok: status >= 200 && status < 300,
        text: async function () { return body; }
    };
}

function fakeFirestore() {
    var state = { value: null };
    var doc = {
        get: async function () { return { exists: !!state.value, data: function () { return state.value; } }; },
        set: async function (value) { state.value = value; },
        delete: async function () { state.value = null; }
    };
    return {
        firestore: { collection: function () { return { doc: function () { return doc; } }; } },
        get value() { return state.value; }
    };
}
