# ReKindle Yandex-only deployment checklist

Publish backend infrastructure before any changed HTML. The checked-in frontend
already points at the new Gateway routes and will fail if it is uploaded first.
Prepared archives are under `/private/tmp/rekindle-yandex-release`; verify all
five non-social archives against `RELEASE-SHA256.txt` before upload. The
frontend archive contains 68 source files plus 45 byte-identical extensionless
HTML aliases, for 113 production objects. Its manifest explicitly excludes the
five changed pages backed by `rekindle-socials`.

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
- [x] All 113 objects from the non-social frontend archive are published to
  Yandex Object Storage. The `rekindle-socials` project, its rules, tokens and
  moderation flows are explicitly outside this rollout.
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

Integration-specific secrets (required only when publishing the corresponding
non-social integration):

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

Attach the minimal permissions needed for Object Storage, Lockbox, Foundation
Models and Vision OCR. Do not set a long-lived `YANDEX_IAM_TOKEN` in production;
the function should receive a service-account token in its invocation context.

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
- `/api/rekindle/social/*`
- `/api/rekindle/content/*`
- `/api/rekindle/games/akinator/*`
- `/api/rekindle/billing/*`
- `/api/rekindle/story/*`

## 5. Firebase callable functions (outside this rollout)

The callables still referenced by active pages are age verification and social
token functions used only by `kindlechat.html`, `neighbourhood.html` and
`topics.html`. They are excluded together with `rekindle-socials`. The legacy
`registerUser` call exists only in `index_old.html` and is not required by the
current dashboard.

If the social deployment is resumed later, deploy from `firebase-functions/`:

```bash
firebase deploy --config firebase.json --project rekindle-fork --only functions
```

The remaining callables provide age verification, social custom-token minting,
moderation user controls and compatibility operations. `getSocialToken` must
not include a `pro` claim, and no callable may enforce ReKindle+ application
access. Verify the deployed function list before continuing.

## 6. Firebase rules

Publish the primary project rules:

```bash
firebase deploy --config firebase.json --project rekindle-fork --only firestore:rules,database,storage
```

The primary Storage rules intentionally deny direct Firebase Storage. Files,
Docs and Photo Frame use the quota-aware Yandex Object Storage backend.

Social Firestore/RTDB rules are deliberately not part of this rollout.

## 7. Stripe

Change the Stripe webhook destination to:

`https://d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net/api/rekindle/billing/webhook`

Keep the webhook signing secret synchronized with `STRIPE_WEBHOOK_SECRET`.
ReKindle+ is supporter status only and must never gate app functionality.

## 8. Verification and future releases

1. `GET /api/rekindle/health` returns HTTP 200.
2. Authenticated storage E2E can upload, list, download and delete a non-Pro
   user's object.
3. AI, OCR and Reader return a controlled response for an authenticated user.
4. A primary Suggestions report rejects mismatched content ownership/path and
   does not require `rekindle-socials` credentials.
5. `/content/proxy` rejects localhost/private destinations and returns a public
   image under 5 MB.
6. `/content/nrl-scores` returns `{ "events": [...] }`.
7. `/api/reddit` returns a Reddit RSS/JSON response, rejects a non-Reddit URL,
   and proxies an allowed image without exceeding the 5 MB bound.
8. Story upload rejects an unauthenticated request, accepts a small Z-code file,
   and its returned `/play/{id}` URL loads.
9. Stripe test-mode checkout and signed webhook both succeed when optional
   supporter billing is enabled.

The 15 July 2026 non-social release has been published and verified byte for
byte. For future releases, run the checks above before publishing the changed
frontend files and their extensionless Object Storage aliases. No page may
restore references to `pro-gate.js` or `js/anti-tamper.js`.

The exact obsolete static-object list is checked in as
`FRONTEND-DELETE-MANIFEST.txt`. Delete those objects only after the replacement
pages are live, so an interrupted upload cannot break the currently deployed
frontend.
