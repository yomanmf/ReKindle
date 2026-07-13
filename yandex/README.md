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

## ReKindle backend without Firebase Blaze

`rekindle-backend/` contains the Node.js 22 Cloud Function used for:

- server-side Firebase registration and IP-ban checks;
- Firebase ID-token verification;
- signed upload/download URLs for the private user-files Object Storage bucket;
- listing and deleting objects owned by the authenticated user.

The function requires these secret-backed environment variables:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

It also requires the non-secret variables `S3_BUCKET` and `ALLOWED_ORIGINS`.
Secrets must be supplied from Yandex Lockbox; never paste them into source files
or ordinary checked-in configuration.

The runtime service account needs only these folder roles:

- `functions.functionInvoker` so API Gateway can invoke the function;
- `lockbox.payloadViewer` so the function can load its three secrets;
- `storage.editor` so it can list, sign, and delete objects in the private bucket.

Do not leave `editor` or a deployment authorized key attached after publishing.

The private bucket stores only keys under `users/{firebaseUid}/files/` and
`users/{firebaseUid}/photos/`. Its CORS policy is checked in as
`user-files-cors.json`. The backend derives the UID from a verified Firebase ID
token and rejects paths belonging to another user. Cloud files remain Pro-only
and are limited to 100 MB per user and 25 MB per object.

`rekindle-api-gateway.yaml` is the combined API Gateway specification for the
deployed `rekindle-backend` function and the existing Reddit proxy. Preserve the
Reddit `GET`/`HEAD` routes and its public CORS behavior when changing the file;
the ReKindle function enforces its own stricter origin allowlist. The browser
client uses `/api/rekindle/*` through the existing `rekindle-api` gateway.

Run the non-mutating unit suite with `npm test`. The production E2E suite is
`npm run test:e2e`; it requires `FIREBASE_WEB_API_KEY` and
`FIREBASE_SERVICE_ACCOUNT_FILE`. It creates a unique temporary account, verifies
registration, custom-token login, IP checking, Pro enforcement, signed upload,
browser CORS, list, download, and delete, then removes the test object, RTDB
profile nodes, and Firebase Auth user in a `finally` cleanup.

For a full-fork Firebase migration, do not bulk-upload a dirty local worktree.
Run `node yandex/prepare-firebase-config-release.js` instead. It downloads the
currently deployed root HTML files and `pro-gate.js`, applies only the seven
exact primary-project config substitutions, creates matching extensionless
HTML aliases, and writes a SHA-256 manifest under
`/private/tmp/rekindle-firebase-config-release`. Review the manifest before any
production upload.
