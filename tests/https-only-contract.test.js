"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");

var policy = require(path.resolve(__dirname, "../yandex/public-site-policy.json"));

test("the public bucket denies every insecure request", function () {
    var rule = policy.Statement.find(function (statement) {
        return statement.Sid === "DenyInsecureTransport";
    });

    assert.equal(rule.Effect, "Deny");
    assert.equal(rule.Principal, "*");
    assert.equal(rule.Action, "*");
    assert.deepEqual(rule.Resource.sort(), ["arn:aws:s3:::rekindle", "arn:aws:s3:::rekindle/*"].sort());
    assert.equal(rule.Condition.Bool["aws:SecureTransport"], "false");
});
