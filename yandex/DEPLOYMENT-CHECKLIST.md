# ReKindle Yandex-only deployment checklist

Publish backend infrastructure before any changed HTML. The checked-in frontend
already points at the new Gateway routes and will fail if it is uploaded first.
Prepared archives are under `/private/tmp/rekindle-yandex-release`; verify all
release archives against `RELEASE-SHA256.txt` before upload. Treat
`FRONTEND-RELEASE-MANIFEST.txt` as authoritative instead of copying historical
object counts. Flipbook is a standalone primary-project application; retired
application pages and aliases are delete-only.

## Production rollout status (18 July 2026, application retirement)

- [x] Backend version `d4e0pfnoifho9c25563m` is active with `$latest`; the
  existing 512 MB runtime, service account, environment, and Lockbox references
  were preserved. `/api/rekindle/health` returns HTTP 200.
- [x] The production API Gateway was updated and the retired Pinterest,
  Substack, TMDB, Chords, NRL scores, Mail, and Suggestions report routes return
  HTTP 404.
- [x] All 84 frontend release objects were uploaded individually and downloaded
  back for byte-for-byte comparison. All 80 delete-manifest keys were removed
  and verified absent across the complete 4,902-object bucket listing.
- [x] The public website serves the Games folder, omits retired catalog IDs,
  serves `rekindle-cache-v23`, and returns HTTP 404 for retired page and alias
  URLs.

## Production rollout status (17 July 2026, Microsoft To Do)

- [ ] Create a Microsoft Entra public-client app registration that supports
  personal and organizational accounts, enables device-code flow, and grants
  delegated `Tasks.ReadWrite` access. Do not create a client secret.
- [ ] Put `MICROSOFT_TODO_SESSION_ENCRYPTION_KEY` in Lockbox and configure the
  public `MICROSOFT_TODO_CLIENT_ID` on `rekindle-backend`.
- [ ] Publish the Firestore client-deny rule for
  `microsoft_todo_sessions/{firebaseUid}`, deploy the backend and Gateway route,
  then verify an authenticated device-code login and one create/update/delete
  cycle before publishing `microsofttodo.html`.

## Production rollout status (16 July 2026, Telegram)

- [x] Primary Firestore rules published as active ruleset
  `f419f69b-7166-4e3e-b6be-9cecd44b0165`; its normalized source matches the
  checked-in rules and denies browser access to `telegram_sessions`.
- [x] Telegram Gateway route is active. Backend version
  `d4e0pfnoifho9c25563m` includes the server-side MTProto implementation, the
  Lockbox-backed session encryption key, and an explicit Firestore dependency.
  `/api/rekindle/health` returns HTTP 200 and an authenticated temporary-user
  request to `/api/rekindle/telegram/status` returned HTTP 200 with stage
  `phone`; test user and documents were deleted afterward.
- [ ] `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are not provisioned. The owner
  authenticated successfully at `my.telegram.org`, but the portal rejected
  several valid application-create requests with only its generic `ERROR`
  alert. Do not use shared Telegram Desktop credentials. The Telegram frontend
  remains intentionally unpublished until owner-specific credentials can be
  created on another connection and stored in Lockbox.

## 1. General backend function

Update Yandex Function `rekindle-backend` (`d4ebc0qtt85o8fb1j2c6`) from the
contents of `rekindle-backend/`:

- Runtime: Node.js 22
- Entry point: `index.handler`
- Service account: the same least-privilege account used by API Gateway
- Timeout: at least 30 seconds
- Memory: at least 512 MB (Reader parsing and OCR share this function)

Required secrets:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Telegram secrets (required before publishing `telegram.html`):

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY` (32 random bytes, base64 encoded)

Microsoft To Do secret (required before publishing `microsofttodo.html`):

- `MICROSOFT_TODO_SESSION_ENCRYPTION_KEY` (32 random bytes, base64 encoded)
- `ANALYTICS_INGEST_TOKEN`

Supporter-billing secrets (required only when Stripe support is enabled):

- `STRIPE_KEY`
- `STRIPE_WEBHOOK_SECRET`

Required non-secret configuration:

- `S3_BUCKET`
- `ALLOWED_ORIGINS=https://rekindle.website.yandexcloud.net,https://tetra.website.yandexcloud.net`
- `ANALYTICS_URL` (the shared Kindle analytics service base URL)
- `YANDEX_FOLDER_ID` (optional when `context.functionFolderId` is present)
- `MICROSOFT_TODO_CLIENT_ID` (public Microsoft Entra application/client ID)
- `MICROSOFT_TODO_TENANT` (optional; defaults to `common`)

Supporter-billing configuration (only when Stripe support is enabled):

- `STRIPE_PRICE_MONTHLY`
- `STRIPE_PRICE_YEARLY`
- `STRIPE_PRICE_LIFETIME`

Keep `@google-cloud/firestore` pinned as a direct backend dependency. Yandex can
omit the copy declared as optional by `firebase-admin`, which causes Firestore
routes to fail at runtime or makes the function cold start return HTTP 502.

Attach the minimal permissions needed for Object Storage, Lockbox, Foundation
Models (`ai.languageModels.user`) and Vision OCR (`ai.vision.user`). Do not set a
long-lived `YANDEX_IAM_TOKEN` in production; the function should receive a
service-account token in its invocation context.

## 2. Reddit function

Update Yandex Function `rekindle-reddit` (`d4egfe65qmv2774tec7m`) from
`reddit-function/`:

- Runtime: Node.js 22
- Entry point: `index.handler`
- Timeout: at least 30 seconds
- Memory: at least 128 MB
- No environment secrets or npm dependencies

Run `npm test` before packaging. The handler must retain its Reddit/Imgur
allowlist, manual redirect validation, 5 MB response cap, 20 MB warm-cache cap,
and stale-cache fallback.

## 3. Story function

Production function `rekindle-story` is `d4ehvm01ga7mfo9vuas6`:

- Entry point: `index.handler`
- Timeout: at least 30 seconds
- Memory: at least 512 MB
- Required variables: `FIREBASE_SERVICE_ACCOUNT_JSON`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Optional `API_GATEWAY_HOST` fallback is the hostname only:
  `d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net`

Its function ID is already present in `rekindle-story/gateway-paths.template.yaml`
and both Story paths are merged into `rekindle-api-gateway.yaml`.

## 4. API Gateway

Update API Gateway `rekindle-api` (`d5dmoqrf9kg552lo4g69`) from
`rekindle-api-gateway.yaml` after merging the Story paths. Verify that all
`function_id` and `service_account_id` values are exact before publishing.

The Gateway must expose:

- `/api/reddit`
- `/api/rekindle/auth/*`
- `/api/rekindle/storage/*`
- `/api/rekindle/integrations/*`
- `/api/rekindle/ai/*`
- `/api/rekindle/content/*`
- `/api/rekindle/telegram/*`
- `/api/rekindle/microsoft-todo/*`
- `/api/rekindle/games/akinator/*`
- `/api/rekindle/billing/*`
- `/api/rekindle/story/*`

## 5. Legacy Firebase callable functions

No active page requires age verification, social token minting or social user
administration. Those callables and the secondary Firebase initialization have
been removed. The legacy `registerUser` call exists only in `index_old.html`;
the current dashboard uses the Yandex registration route.

If a remaining legacy callable must be published, deploy from
`firebase-functions/`:

```bash
firebase deploy --config firebase.json --project rekindle-fork --only functions
```

Verify the deployed function list before continuing and do not reintroduce a
secondary Firebase service account.

## 6. Firebase rules

Before tightening the RTDB rules, audit and migrate the retired public profile
trees. The command is dry-run unless `--force` is present; the forced run copies
valid Life birthdays to `users_private/{uid}/life/birthday` before deleting
`users_public` and `user_cards`:

```bash
node admin/retire-public-profiles.js
node admin/retire-public-profiles.js --force
```

Publish the primary project rules:

```bash
firebase deploy --config firebase.json --project rekindle-fork --only firestore:rules,database,storage
```

The primary Storage rules intentionally deny direct Firebase Storage. Files,
Docs and Photo Frame use the quota-aware Yandex Object Storage backend.

The repository contains only primary Firestore/RTDB rules.

## 7. Stripe

Change the Stripe webhook destination to:

`https://d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net/api/rekindle/billing/webhook`

Keep the webhook signing secret synchronized with `STRIPE_WEBHOOK_SECRET`.
ReKindle+ is supporter status only and must never gate app functionality.

## 8. Verification and future releases

1. `GET /api/rekindle/health` returns HTTP 200.
2. Authenticated storage E2E can upload, list, download and delete a non-Pro
   user's object.
3. Authenticated `POST /ai/chat` with `{ "action": "quota" }` returns a quota,
   a shared prompt returns non-empty text and decrements that quota exactly once,
   and a failed provider request releases its reservation. OCR and Reader return
   a controlled response for an authenticated user.
4. `/content/proxy` rejects localhost/private destinations and returns a public
   image under 5 MB.
5. `/api/reddit` returns a Reddit RSS/JSON response, rejects a non-Reddit URL,
   and proxies an allowed image without exceeding the 5 MB bound.
6. Story upload rejects an unauthenticated request, accepts a small Z-code file,
   and its returned `/play/{id}` URL loads.
7. Stripe test-mode checkout and signed webhook both succeed when optional
   supporter billing is enabled.

For future releases, run the checks above before publishing the changed frontend
files and their extensionless Object Storage aliases. No page may restore
references to `pro-gate.js` or `js/anti-tamper.js`.

The exact obsolete static-object list is checked in as
`FRONTEND-DELETE-MANIFEST.txt`. Delete those objects only after the replacement
pages are live, so an interrupted upload cannot break the currently deployed
frontend.

`yc storage s3 cp --recursive` is a preview command and may return exit code 0
after uploading only part of a release. The AI Assistant rollout omitted 42 of
113 objects until they were sent individually. Every release must therefore be
read back and matched against the complete manifest; use `s3api put-object` for
any missing object and set extensionless aliases to `text/html` explicitly.

If Firebase CLI fails only its Service Usage preflight with
`serviceusage.services.get`, do not grant a broad role just to pass that check.
A service account that already has Firebase Rules permissions can publish with
the official Admin SDK `SecurityRules` API; verify the resulting active ruleset
source and hash immediately after release.
