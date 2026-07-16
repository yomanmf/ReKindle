# ReKindle Yandex-only deployment checklist

Publish backend infrastructure before any changed HTML. The checked-in frontend
already points at the new Gateway routes and will fail if it is uploaded first.
Prepared archives are under `/private/tmp/rekindle-yandex-release`; verify all
five release archives against `RELEASE-SHA256.txt` before upload. The current
frontend manifest contains 74 source files plus 48 byte-identical extensionless
HTML aliases, for 122 production objects. Pixel and Flipbook are standalone
primary-project applications; retired internal-social pages are delete-only.

## Production rollout status (16 July 2026, Telegram)

- [x] Primary Firestore rules published as active ruleset
  `f419f69b-7166-4e3e-b6be-9cecd44b0165`; its normalized source matches the
  checked-in rules and denies browser access to `telegram_sessions`.
- [x] Telegram Gateway route is active. Backend version
  `d4epdt7g8p5tumctlbbi` includes the server-side MTProto implementation, the
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

## Production rollout status (15 July 2026)

- [x] `rekindle-backend` updated and running with Node.js 22, 30-second timeout
  and 512 MB memory. Health and NRL routes return HTTP 200.
- [x] `rekindle-reddit` updated. Non-allowlisted URLs return HTTP 403; allowed
  Reddit requests reach the upstream service.
- [x] `rekindle-story` created as `d4ehvm01ga7mfo9vuas6` with Node.js 22,
  30-second timeout and 512 MB memory. Unauthenticated upload returns HTTP 401
  and a missing game returns HTTP 404 through the gateway.
- [x] `rekindle-api` updated with the current backend, NRL and Story paths.
- [x] Primary Firestore and RTDB rules published. The production primary RTDB
  no longer contains the obsolete `pro_gate` rule. The Suggestions report
  backend writes through the Admin SDK and is live; publishing the newer
  `suggestion_reports` client-read block is needed only before exposing a
  browser moderation queue for those records.
- [ ] Primary Firebase Storage rules cannot be published because the Spark
  project has no provisioned Firebase Storage product. Direct Firebase Storage
  remains unavailable; user files use the Yandex backend.
- [ ] The general backend still needs optional Pinterest, TMDB and Stripe
  integration configuration listed below. The existing Lockbox secret supplies
  the primary Firebase service account and S3 credentials; AI and OCR use the
  Yandex service-account token from the function invocation context.
- [ ] Stripe webhook migration and authenticated integration E2E checks remain.
- [x] All 113 objects from the previous frontend archive are published to
  Yandex Object Storage.
- [x] Social-removal release published on 15 July 2026: the backend and Gateway
  no longer expose social routes, the public-profile migration completed,
  primary Firestore/RTDB rules were published, all 118 frontend objects were
  verified, and the eight HTML/extensionless internal-social objects were
  deleted. The full delete manifest removed ten objects including the already
  retired `pro-gate.js` and `js/anti-tamper.js`.
- [x] Local social-removal verification passed: contract 5/5, backend 28/28,
  Reddit 3/3, changed inline scripts, YAML, locale/rules JSON, and the complete
  118-object release archive.
- [x] Production social-removal verification passed: `/index`, `/pixel` and
  `/flipbook` return HTTP 200; KindleChat, Neighbourhood, Topics and Moderation
  HTML/extensionless routes return HTTP 404; the retired social Gateway route
  returns HTTP 404; `icons.js` contains no retired catalog IDs; and `sw.js`
  serves `rekindle-cache-v22` with cache revalidation enabled.
- [x] Local verification passed: backend 28/28, Reddit 3/3, Story syntax,
  changed inline scripts (50 HTML files), release checksums and locale/rules JSON.
- [x] Production comparison reports 113/113 byte-identical objects, with no
  missing or different files. Extensionless pages and representative JS/JSON
  assets return their intended MIME types.
- [x] Obsolete `pro-gate.js` and `js/anti-tamper.js` objects were deleted and
  return HTTP 404 in production.
- [x] Production smoke checks passed for health, NRL, Suggestions routing,
  protected AI/OCR/mail/storage/Reader/Akinator routes, proxy private-address
  rejection, Reddit allowlisting and Story missing-game handling.
- [x] Firebase web-key hotfix published on 15 July 2026. All 70 affected HTML
  objects and extensionless aliases match the release manifest, the production
  audit found no API-key placeholder across 229 existing objects, and the
  owner login plus server-side IP check both passed.
- [x] AI Assistant backend release `d4em36gkmifsm2tef1no` published on 15 July
  2026 with `ai.languageModels.user`, an explicit `YANDEX_FOLDER_ID`, atomic
  server quota/refund, bounded provider timeouts and request IDs. Authenticated
  production E2E passed for a real shared YandexGPT answer, quota decrement,
  signed upload/download/delete and cleanup.
- [x] The corresponding 113 frontend objects were republished and read back
  byte-for-byte. `/chat` and all extensionless aliases use `text/html`; the
  production page shows the localized signed-out state with no JavaScript
  console errors.
- [x] AI Assistant Firestore cleanup published as active ruleset
  `eadc917f-8ffc-4d47-91cb-4e2a671dec96`. Its normalized SHA-256 matches the
  checked-in `firestore.rules`, and the obsolete client-writable
  `users/{uid}/chatLimits` match is absent.

## 1. General backend function

Update Yandex Function `rekindle-backend` (`d4ebc0qtt85o8fb1j2c6`) from the
contents of `rekindle-backend/`:

- Runtime: Node.js 22
- Entry point: `index.handler`
- Service account: the same least-privilege account used by API Gateway
- Timeout: at least 30 seconds
- Memory: at least 512 MB (Reader parsing, IMAP and OCR share this function)

Required secrets:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Telegram secrets (required before publishing `telegram.html`):

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY` (32 random bytes, base64 encoded)

Integration-specific secrets (required only when publishing the corresponding
integration):

- `PINTEREST_CLIENT_ID`
- `PINTEREST_CLIENT_SECRET`
- `TMDB_API_KEY`
- `STRIPE_KEY`
- `STRIPE_WEBHOOK_SECRET`

Required non-secret configuration:

- `S3_BUCKET`
- `ALLOWED_ORIGINS=https://rekindle.website.yandexcloud.net`
- `YANDEX_FOLDER_ID` (optional when `context.functionFolderId` is present)

Supporter-billing configuration (only when Stripe support is enabled):

- `STRIPE_PRICE_MONTHLY`
- `STRIPE_PRICE_YEARLY`
- `STRIPE_PRICE_LIFETIME`

Optional report notifications:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID`

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
- `/api/rekindle/mail/*`
- `/api/rekindle/reports/submit`
- `/api/rekindle/content/*`
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
4. A Suggestions report rejects mismatched content ownership/path and uses only
   primary Firebase credentials.
5. `/content/proxy` rejects localhost/private destinations and returns a public
   image under 5 MB.
6. `/content/nrl-scores` returns `{ "events": [...] }`.
7. `/api/reddit` returns a Reddit RSS/JSON response, rejects a non-Reddit URL,
   and proxies an allowed image without exceeding the 5 MB bound.
8. Story upload rejects an unauthenticated request, accepts a small Z-code file,
   and its returned `/play/{id}` URL loads.
9. Stripe test-mode checkout and signed webhook both succeed when optional
   supporter billing is enabled.

The preceding Yandex/paywall release has been published and verified byte for
byte. The internal-social removal release remains pending as recorded above.
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
