# Yandex Cloud deployment

The Reddit frontend is hosted in Yandex Object Storage. Its API proxy runs in
Yandex Cloud Functions behind Yandex API Gateway.

## Reddit proxy

Deployed resources in the `default` folder:

- Cloud Function: `rekindle-reddit` (`d4egfe65qmv2774tec7m`)
- API Gateway: `rekindle-api` (`d5dmoqrf9kg552lo4g69`)
- Public API endpoint:
  `https://d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net/api/reddit`

The function uses the Node.js 22 runtime, `index.handler`, 128 MB memory, and a
30-second timeout. It is currently public so API Gateway can invoke it without
a service account. For stricter access control, make it private and assign a
service account with `functions.functionInvoker` to the Gateway integration.

To publish an update, replace the function's `index.js` with
`reddit-function/index.js`, create a new function version, and keep the
`$latest` tag. The Gateway specification already contains the deployed function
ID. If the Gateway is recreated, update `REDDIT_PROXY_ENDPOINT` in `reddit.html`.

When publishing the frontend to the `rekindle` Object Storage bucket, upload
the page under both `reddit.html` and `reddit`. Object Storage does not perform
an extensionless rewrite, and the public application URL is `/reddit`.

The function has no npm dependencies. It validates the destination hostname,
supports feeds and images, and uses a bounded warm-instance cache with a stale
fallback. This cache is intentionally best-effort; use YDB if a persistent,
cross-instance cache is required later.
