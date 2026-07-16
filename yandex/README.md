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
ID. If the Gateway is recreated with a different hostname, update the single
base URL in `js/rekindle-cloud.js`; `reddit.html` derives `/api/reddit` from it.

When publishing the frontend to the `rekindle` Object Storage bucket, upload
the page under both `reddit.html` and `reddit`. Object Storage does not perform
an extensionless rewrite, and the public application URL is `/reddit`.

`prepare-frontend-release.js` reads source files containing
`__REKINDLE_FIREBASE_API_KEY__`, requires `REKINDLE_FIREBASE_API_KEY`, and
injects the concrete public Firebase web key only into staged release objects.
Never upload the checked-in HTML files directly: the source placeholder makes
Firebase Auth fail with `auth/api-key-not-valid`. The release script scans every
archive object and stops if a placeholder remains.

The function has no npm dependencies. It validates the destination hostname,
supports feeds and images, and uses a bounded warm-instance cache with a stale
fallback. This cache is intentionally best-effort; use YDB if a persistent,
cross-instance cache is required later.

## ReKindle backend without Firebase Blaze

`rekindle-backend/` contains the Node.js 22 Cloud Function used for:

- server-side Firebase registration and IP-ban checks;
- Firebase ID-token verification;
- signed upload/download URLs for the private user-files Object Storage bucket;
- listing and deleting objects owned by the authenticated user;
- authenticated AI, OCR, mail, content proxies, Suggestions reports, and billing.
- an authenticated Telegram MTProto client with encrypted per-user sessions and optional MTProxy routing.
- a public GET/HEAD content proxy with SSRF protection, IP rate limits and a
  5 MB response cap, plus the NRL scoreboard route used by local apps.

The function requires these secret-backed environment variables:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `PINTEREST_CLIENT_ID`
- `PINTEREST_CLIENT_SECRET`
- `TMDB_API_KEY`
- `STRIPE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY` (exactly 32 random bytes encoded as base64)

It also requires the non-secret variables `S3_BUCKET`, `ALLOWED_ORIGINS`,
`YANDEX_FOLDER_ID`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, and
`STRIPE_PRICE_LIFETIME`. `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` are
optional; without them, Suggestions reports are still stored but no Discord embed is
sent. `YANDEX_IAM_TOKEN` is a local/emergency fallback only: production should
use the IAM token supplied to the function through its attached service account.
Secrets must be supplied from Yandex Lockbox; never paste them into source files
or ordinary checked-in configuration.

Telegram authorization sessions are stored in the server-only Firestore
`telegram_sessions/{firebaseUid}` collection after AES-256-GCM encryption. The
browser cannot access that collection directly. Login codes and 2FA passwords
are never persisted. User-supplied MTProxy hosts are DNS-resolved and rejected
if any result is private or local before the encrypted configuration is saved.

The runtime service account needs only these folder roles:

- `functions.functionInvoker` so API Gateway can invoke the function;
- `lockbox.payloadViewer` so the function can load its secrets;
- `storage.editor` so it can list, sign, and delete objects in the private bucket.
- `ai.languageModels.user` for the shared YandexGPT route;
- `ai.vision.user` for Vision OCR.

Do not leave `editor` or a deployment authorized key attached after publishing.

The private bucket stores only keys under `users/{firebaseUid}/files/` and
`users/{firebaseUid}/photos/`. Its CORS policy is checked in as
`user-files-cors.json`. The backend derives the UID from a verified Firebase ID
token and rejects paths belonging to another user. Cloud files are available to
every authenticated user and are limited to 100 MB per user and 25 MB per object.

`rekindle-api-gateway.yaml` is the combined API Gateway specification for the
deployed `rekindle-backend` function and the existing Reddit proxy. Preserve the
Reddit `GET`/`HEAD` routes and its public CORS behavior when changing the file;
the ReKindle function enforces its own stricter origin allowlist. The browser
client uses `/api/rekindle/*` through the existing `rekindle-api` gateway.

Suggestions reports use `/api/rekindle/reports/submit` and write only to the
primary Firebase RTDB after validating the stored content owner and canonical
path. The retired internal social project is not part of the runtime.

The former relative `/api/proxy`, `/api/maps`, `/api/price`, and
`/api/nrl-scores` Pages Functions have been removed. Frontend pages call
`/api/rekindle/content/proxy` or `/api/rekindle/content/nrl-scores` through
`RekindleCloud.apiBase`. Static Object Storage does not execute relative API
routes, so never reintroduce those paths.

Run the non-mutating unit suite with `npm test`. The production E2E suite is
`npm run test:e2e`; it requires `FIREBASE_WEB_API_KEY` and
`FIREBASE_SERVICE_ACCOUNT_FILE`. It creates a unique temporary account, verifies
registration, custom-token login, IP checking, an authenticated shared
YandexGPT response with server-authoritative quota readback, signed upload,
browser CORS, list, download, and delete, then removes the test object, private
RTDB/quota/rate-limit nodes, and Firebase Auth user in a `finally` cleanup.

Do not rely on a successful `yc storage s3 cp --recursive` exit status for
frontend releases. Yandex CLI 1.18.0 silently omitted 42 of 113 objects during
the AI Assistant rollout while returning zero. Read every manifest object back,
compare it byte-for-byte, upload missing keys with `storage s3api put-object`,
and force `text/html` for extensionless page aliases.

A Firebase rules service account may be able to create and release Rulesets but
lack the unrelated `serviceusage.services.get` permission used by the Firebase
CLI preflight. Do not expand IAM for that check alone. Use the official Firebase
Admin SDK `SecurityRules` API and verify `getFirestoreRuleset()` against the
checked-in source immediately after publishing.

For a full-fork Firebase migration, do not bulk-upload a dirty local worktree.
Run `REKINDLE_FIREBASE_API_KEY=... node yandex/prepare-firebase-config-release.js`
instead. It downloads the currently deployed root HTML files, replaces a
published API-key placeholder and any supplied
`REKINDLE_CURRENT_FIREBASE_API_KEY`, applies the exact primary-project config
substitutions, creates matching extensionless HTML aliases, and writes a
SHA-256 manifest under `/private/tmp/rekindle-firebase-config-release`. Review
the manifest before any production upload.

## Interactive Story function

`rekindle-story/` is a separate Node.js 22 Yandex Function. It keeps the existing
Z-machine interpreter but replaces Cloudflare KV with Yandex Object Storage
under `story-runtime/`. Uploads require a primary Firebase ID token.

Production uses function `d4ehvm01ga7mfo9vuas6`. Its upload and play paths are
already present in both `rekindle-story/gateway-paths.template.yaml` and the
main Gateway spec. Keep the two specs synchronized if the function is replaced.

The Story function requires `FIREBASE_SERVICE_ACCOUNT_JSON`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. `API_GATEWAY_HOST` is an optional
fallback because normal gateway requests provide the host header. Use the same
private bucket as the main backend; its objects are isolated under
`story-runtime/`. The upload route requires Firebase authentication, accepts
only Z-code versions 1-3, and rejects decoded story files larger than 2 MB.
