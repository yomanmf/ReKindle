"use strict";

var sqsPackage = require("@aws-sdk/client-sqs");
var client;

async function publish(options) {
    options = options || {};
    var env = options.env || process.env;
    var queueUrl = String(options.queueUrl || "");
    var dispatchId = String(options.dispatchId || "");
    if (!queueUrl || !dispatchId) throw new Error("Yandex Message Queue is not configured.");
    await getClient(env).send(new sqsPackage.SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ id: String(options.id || ""), dispatchId: dispatchId }),
        MessageGroupId: String(options.groupId || "rekindle"),
        MessageDeduplicationId: dispatchId
    }));
}

function getClient(env) {
    if (!client) {
        client = new sqsPackage.SQSClient({
            region: "ru-central1",
            endpoint: "https://message-queue.api.cloud.yandex.net",
            credentials: {
                accessKeyId: required(env, "YMQ_ACCESS_KEY_ID"),
                secretAccessKey: required(env, "YMQ_SECRET_ACCESS_KEY")
            }
        });
    }
    return client;
}

function required(env, name) {
    var value = String(env[name] || "");
    if (!value) throw new Error(name + " is not configured.");
    return value;
}

module.exports = { publish: publish };
