# Backend, data, and deployment reference

## Retired Cloudflare Pages Functions

Production is hosted as a static Yandex Object Storage website and does not execute `functions/api/*`. The former Pages handlers have been removed. Never add relative `/api/...` frontend URLs: add an explicit route to `yandex/rekindle-api-gateway.yaml`, implement it in a Yandex Function, and use the shared `RekindleCloud.apiBase` URL.


## 🏗 System Architecture

### 1. JavaScript Execution (JIT-less)
*   **Engine:** V8 (Ignition Interpreter ONLY).
*   **Flag:** `--js-flags="jitless"`.
*   **Impact:** **5x-10x slower** CPU performance than standard mobile browsers.
*   **Rule:** Avoid heavy computation, crypto, or massive data parsing on the main thread.

### 2. Localization
*   **Method:** Use `data-i18n` attributes for all text content.
*   **Library:** `js/i18n.js` handles replacement automatically.

### 3. Viewport & Rendering
*   **Meta Tag:** `user-scalable=no`.
*   **Sticky Positioning:** AVOID `position: sticky` or `fixed` header/footers. They cause "checkerboarding" artifacts during E-ink page refreshes.
*   **Touch Targets:** Minimum **48x48px**.

### 4. Storage & State
*   **Persistence:** `localStorage` is available but **volatile**.
*   **Limit:** **64MB** Global Cache Limit. If exceeded, the OS performs `rm -rf` on the entire cache directory at launch.
*   **Sync:** Rely on Firebase Firestore for critical data; do not trust `localStorage` for long-term storage.

### 5. Timezone & Date Quirks
*   **Constraint:** The Kindle browser (`Intl` API) often defaults to **UTC** or ignores the system timezone configuration.
*   **Impact:** `new Date().getHours()` return UTC hours, not local wall time. `toLocaleString()` often fails to apply named timezones (e.g. "Australia/Sydney").
*   **Date Formatting:** The Kindle browser does **not reliably support** `dateStyle` / `timeStyle` options in `toLocaleString()` / `Intl.DateTimeFormat`. Output may differ from desktop browsers or be ignored entirely. **Always use manual string formatting** (e.g., building `"Feb 10, 2026 at 2:42 PM"` from individual date components) instead of relying on these options.
*   **Solution:**
    *   Avoid relying on `Intl.DateTimeFormat` for timezone shifting.
    *   Use a **Manual Offset** strategy: Store a numeric offset (e.g., `+11`) and mathematically shift the timestamp before displaying.
    *   Use the `time.js` helper `rekindleGetZonedDate()` which handles this shim.
*   **Timezone Setting Modal (`time.js`):**
    *   `time.js` injects a lazy System 7 modal (`checkTimezoneOffset()`) when the user has not saved a timezone offset.
    *   It triggers **only** when local-time helpers are actually called (`rekindleGetZonedDate()`, `rekindleFormatTime()`, `getDateInZone()` without an explicit zone) — it does **not** run automatically on every page load.
    *   The modal searches the Open-Meteo geocoding API, fetches the UTC offset, saves it to `localStorage` (`rekindle_location_manual` + `rekindle_timezone_offset`), and **reloads the page** on success.
    *   It has **no dismiss button** — the user must set their timezone or leave the popup open.
    *   Because this modal is injected into arbitrary host pages, it is subject to the class-name leakage warning in section 6 above.

### 6. Canvas / Touch Coordinate Bug with CSS `zoom`

**Context:** `theme.js` can apply a CSS `zoom` scale to `.window` elements via user settings (`rekindle_scale`).

**Kindle Bug:** On the Kindle experimental browser, when `zoom` is active on an ancestor, `getBoundingClientRect()` returns **pre-zoom layout coordinates** while `TouchEvent`/`MouseEvent` `clientX`/`clientY` are in **post-zoom viewport coordinates**. This causes a massive touch offset (often several centimeters) for any canvas-based drawing or click-target game.

**Solution — Exempt the Game Window from Scaling:**
Games that rely on precise canvas coordinates (drawing, drag-and-drop, grid clicks, etc.) must override the global scaling rule so the `.window` renders at `zoom: 1`, while still allowing the title-bar to scale for readability.

Add this CSS block **after** your existing `.window` / `.title-bar` rules and **before** `</style>`:

```css
/* Override global scaling - only scale title-bar */
.window {
    zoom: 1 !important;
    transform: none !important;
}

.title-bar {
    zoom: var(--rekindle-scale, 1);
}

@supports not (zoom: 1) {
    .title-bar {
        transform: scale(var(--rekindle-scale, 1));
        transform-origin: top center;
    }
}
```

**Apps already using this fix:** `pool.html`, `pool2p.html`, `circle.html`, `blockblast.html`.

### 7. Firebase Architecture
The project uses **two separate Firebase projects**. You must know which one your feature targets and update the correct rules file.

#### Project 1: Primary (`rekindle-fork`)
*   **Used by:** Most apps (games, tools, personal data). Any HTML file using `projectId: "rekindle-fork"`. The upstream project ID was `rekindle-dd1fa`; do not reintroduce it in this fork.
*   **Config:** `firebase.json`
*   **Firestore Rules:** `firestore.rules` — user data, leaderboards, app-specific collections.
*   **Storage Rules:** `storage.rules` — direct Firebase Storage is denied; user files and photos use the quota-aware Yandex backend for every authenticated user.
*   **RTDB Rules:** `rtdb-rules.json` — private user state, presence, multiplayer, and API rate-limit data. There is no Pro gate.
*   **Cloud Functions:** `firebase-functions/index.js`

The primary RTDB is hosted in Belgium (`europe-west1`). Its canonical URL is
`https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app`. A
regional RTDB does not use the legacy `PROJECT-default-rtdb.firebaseio.com`
hostname. Always copy the URL shown in the Firebase console into every explicit
`databaseURL`; changing only the project ID produces a valid-looking but wrong
hostname.

**Firebase console rules editor gotcha:** Calling an automation-style `fill()`
on the Firestore or RTDB code editor can append the new rules after the existing
rules. Firestore then reports an error such as `Unexpected 'rules_version'` on
the first line after the intended file. Focus the editor textbox, send
`ControlOrMeta+A`, send `Backspace`, and only then fill the complete rules file.
Before publishing, verify that `rules_version = '2';` appears exactly once (for
Firestore) and that the default deny-all starter block is gone.

**Firebase CLI service-account preflight gotcha:** `firebase-tools@15.23.0`
checks `serviceusage.googleapis.com` before a Firestore rules deploy. A narrowly
scoped deployment service account can have all required Firebase Rules
permissions but still receive `403 Permission denied to get service
[firestore.googleapis.com]` because it lacks `serviceusage.services.get`. Do not
broaden IAM only to satisfy this preflight. The already-installed official
Firebase Admin SDK can publish the same source with
`securityRules().releaseFirestoreRulesetFromSource()`; immediately call
`getFirestoreRuleset()` and compare the active source/hash with the checked-in
file. The AI Assistant rollout used this path and verified active ruleset
`eadc917f-8ffc-4d47-91cb-4e2a671dec96` byte-for-byte after normalized newlines.

#### Rule Update Checklist
When adding a new feature that writes to Firebase, you **must** update the corresponding rules:

| If your feature writes to... | Update this file |
| :--- | :--- |
| Primary Firestore (leaderboards, user collections) | `firestore.rules` |
| Primary Storage (user files/photos) | `storage.rules` |
| Primary RTDB (presence, sessions) | `rtdb-rules.json` |

Without matching rules, writes will be **silently rejected** by security rules. Always follow the existing patterns in the target file for authenticated-user-only collections.

**Firestore overlapping-match gotcha:** Security-rule `match` blocks are ORed, not ordered by specificity. A restrictive exact match does not override a broader permissive match. For example, both `match /privateSettings/ai` and `match /privateSettings/{docId}` match the `ai` document; if the wildcard rule allows the owner unconditionally, the intended stricter check in the exact rule is ineffective. Put the conditional in the wildcard rule (for example, branch on `docId == 'ai'`) or exclude the sensitive document from the broad allow. Audit other exact-plus-wildcard pairs the same way.

**Removing a client paywall does not create backend access control:** CORS is not authentication and can be bypassed by non-browser clients. The Yandex routes for AI, OCR, Files, Docs, Photo Frame, and Microsoft To Do therefore verify a primary Firebase ID token and enforce server-side per-user rate limits or storage quotas. Files, Docs, and Photo Frame are open to every authenticated user while retaining path ownership, MIME/type validation, 100 MB per-user storage, and 25 MB per-object limits. Direct Firebase Storage is deliberately denied by `storage.rules`; it has no byte-quota mechanism and must not be reopened as a shortcut.

**Yandex-only production architecture:** Browser code must call Yandex Cloud Functions through the `rekindle-api` API Gateway. Cloudflare Worker sources and Wrangler manifests have been removed. Do not restore their endpoints or patch old CORS allowlists. A new server route must be implemented and tested in Yandex before its frontend is published.

**Corporate Exchange Calendar:** The calendar uses the fixed public EWS endpoint
`https://mailsec.o3t.ru/EWS/Exchange.asmx` through the authenticated Yandex
backend route `/api/rekindle/exchange-calendar/{action}`. Browser code must
never call EWS or build a Basic Authorization header. The backend stores the
`@ozon.ru` email and app password in the server-only
`exchange_calendar_sessions` collection using UID-bound AES-256-GCM; direct
Firestore access stays denied. The feature is intentionally read-only and
fetches event bodies with EWS `GetItem`. Reuse
`MICROSOFT_TODO_SESSION_ENCRYPTION_KEY` unless a separate
`EXCHANGE_CALENDAR_ENCRYPTION_KEY` is configured.

**Calendar guest-state gotcha:** `calendar.html` previously assigned
`currentUser` only inside the signed-in auth branch, creating an implicit
global. Guest paths that merely read it then throw `ReferenceError`. Keep
`auth`, `db`, and `currentUser` explicitly declared and reset `currentUser` to
`null` when authentication is cleared. For Kindle Scribe Colorsoft responsive
QA, verify the Exchange modal at a 990x1320 portrait viewport and also at the
more conservative 632x840 viewport; neither layout may create horizontal
document overflow.

The read-only event-details modal and the dashboard's generic event-details
dialog close when their backdrop is tapped. Keep the `event.target === this`
guard so taps inside the modal do not close it; do not copy this behavior to
editing or confirmation dialogs that can discard work.

Both pages disable selection on `body`. Keep `user-select: text` and
`-webkit-user-select: text` scoped to the read-only event details so meeting
text remains selectable on desktop and mobile browsers.

**Exchange query-range gotcha:** Do not load a year of Exchange events in one
EWS `CalendarView` request. The dashboard succeeds because it requests a small
window, while the large calendar request can time out before `GetItem` returns.
`calendar.html` requests only the visible day or month (with timezone padding),
and reloads Exchange when those views navigate. Keep agenda look-ahead bounded.

**Dashboard Exchange auth-race gotcha:** `index.html` can render the agenda
before Firebase restores `currentUser`. When Exchange is selected, keep the
agenda empty during that transient state; do not show a misleading sign-in
message while the mandatory login session is still loading.

**Oracle custom-provider routing:** The old Worker ignored the provider-specific `endpoint` from `chat.html` and always called OpenAI. The Yandex implementation in `yandex/rekindle-backend/index.js` fixes this with an explicit provider endpoint allowlist. Keep model listing and inference on the same validated endpoint policy, and never allow loopback, link-local, or private-network targets.

**Billing and supporter subsystem retired (July 2026):** ReKindle+ access checks,
badges, subscription UI, Stripe routes, the `config/supporters` document, Auth
`pro` claims, and the `isPro`, `proExpiresAt`, `stripeCustomerId`, and
`subscriptionType` user fields were removed. Do not recreate `pro-gate.js`,
`app.plus`, supporter cosmetics, checkout/webhook routes, or subscription data.

**Retired internal social subsystem (July 2026):** The separate
`rekindle-socials` Firebase project is no longer part of the application.
KindleChat, Neighbourhood, Topics, Moderation, age verification, social custom
tokens, public profile cards, and their moderation/translation/reporting routes
were removed. Do not recreate their pages, Firebase configuration, rules,
callables, Gateway routes, locale keys, or admin scripts.

Flipbook remains a standalone creative tool and uses the primary Firestore
`flipnote_animations` collection. It does not post into a feed or depend on
RTDB. The dashboard and multiplayer games use deterministic UID-derived avatar
seeds instead of public profile cards.

The frontend release manifest includes `flipbook.html`. The delete manifest
includes both HTML and extensionless object keys for the four
retired social pages so stale production URLs are removed after rollout.
Before publishing the primary RTDB rules, run
`admin/retire-public-profiles.js` without arguments to audit the migration and
then with `--force`: it preserves valid Life birthdays under the private path
before removing the obsolete `users_public` and `user_cards` trees.

**Removing a paywall includes its locale contract:** When a gated component is deleted, remove its unused translation keys too. Stale keys such as `airtype.paywall.*`, `quicknotes.paywall.*`, `quicktodo.pro.*`, and `paywall.popup.*` previously continued to advertise exclusive apps and could be resurrected by cached or legacy markup.

**Donation prompts are retired (July 2026):** Do not add donation buttons, QR
codes, checkout plans, Ko-fi links, upgrade banners, subscription management,
or supporter status back to the dashboard, settings, or locale files.

**OCR MIME must match the canvas encoding:** Quick ToDo and Quick Notes encode cropped handwriting with `canvas.toDataURL('image/jpeg', ...)`. Their Yandex OCR request must send `mimeType: 'JPEG'`; hard-coding `PNG` in the backend produces invalid or unreliable recognition. The backend accepts only `PNG` and `JPEG` and forwards the validated value to Yandex Vision OCR.

**Books to Kindle direct-worker contract:** `bookskindle.html` never calls or
simulates Telegram. Authenticated user actions are stored in the server-only
`server/books_kindle/books_kindle_*` primary RTDB tree by
`books-kindle-service.js`; the
backend publishes `jobId + dispatchId` to the Books FIFO queue and the Flibusta
worker claims it through `/api/rekindle/books-kindle-worker/claim`, reusing its existing
catalog/conversion/cover/SMTP pipeline, and reports status back. Keep raw source
URLs and Kindle addresses out of public job responses, keep all three
trees server-only, and reuse the existing worker secret only through the
backend's timing-safe bearer check. Do not move Books state back to Firestore:
the Spark daily quota previously exhausted and made every Books request hang
until the 30-second Yandex Function timeout.

**Books worker deploy verification:** The production bot routes Telegram through
`RUNTIME_TELEGRAM_PROXY_URL`. Its VM deploy-agent must pass that proxy to the
Telegram `getMe` health check too. A direct check times out after the stability
delay, rolls back a healthy worker image with generic `COMMAND_FAILED`, and
leaves web jobs indefinitely at `Waiting for the books worker.`

**Books worker runtime secret:** The production VM reads
`BOOKS_KINDLE_WORKER_SECRET` and the YMQ reader key from the dedicated deletion-protected
`books-kindle-worker-runtime` Lockbox secret. Its service account has
`lockbox.payloadViewer` on that one secret only, and the secret ID is exposed
through VM metadata key `books-kindle-lockbox-secret-id`. Do not grant the VM
access to the shared backend secret because it also contains Firebase and S3
credentials.

**Books worker author lookup:** Limit Flibusta author discovery to the first
OPDS page for each query word. Broad title words such as `история` can contain
hundreds of author-result pages; scanning all of them leaves the web job in
`searching` indefinitely. This limit does not apply to normal book search or
its title/author fallbacks. `start_search` must issue the exact book query before
author discovery so an unavailable catalog fails after one network timeout
instead of serially exhausting every author and fallback request.
If an author feed has another page and the bounded lookup finds no books, pass
`firstPageOnly: true` through the worker result and public job. The frontend
must translate that flag into an explicit prompt to search by a more specific
title instead of showing the generic no-results message. A ready job with no
results and no `firstPageOnly` flag must show the localized generic no-results
message, never the ready-state prompt to choose a book.
Map the worker's exact `Flibusta search is unavailable` failure to the localized
`bookskindle.catalog_unavailable` message. Do not show the first-page message for
an upstream outage: no catalog page was successfully searched in that case.

Books Kindle status bars and job details omit a single sentence-ending period
when rendered, while preserving ellipses such as `Searching...`. Keep this in
the shared `statusText()` display helper so worker-provided messages follow the
same rule without rewriting stored job data or every locale string.
While a job is running, render its worker-provided `message` before falling back
to the generic phase label; otherwise detailed retry and health-check progress
is stored correctly but hidden from the user. Bump the `bookskindle.js` query
version in `bookskindle.html` whenever this rendering logic changes.
Search completion can also carry a worker-provided source message. Preserve it
in `finishSearch()` and render it for ready jobs so the API/web winner remains
visible after the running job becomes ready.

**Firebase Auth sessions are API-key scoped:** Every checked-in authenticated
page, including `bookskindle.html`, must use the
`__REKINDLE_FIREBASE_API_KEY__` placeholder. A hard-coded key can initialize the
same Firebase project but read a different local Auth persistence slot, making
an already signed-in user appear signed out. Let
`yandex/prepare-frontend-release.js` inject the shared production key.

**Scope cross-feature route tests:** The shared API Gateway contains actions
for several Kindle applications. A contract for one application must inspect
that application's route block or service instead of rejecting an action name
across the entire Gateway; `kindle-status`, for example, belongs to Books to
Kindle and must not fail Manga to Kindle tests.

**Small title-bar touch targets:** A transparent pseudo-element around a 20px
`.close-box` is not a reliable touch target in the Kindle browser, and its top
can also be clipped by `.window { overflow: hidden; }`. In Books to Kindle, the
button itself is 48px and transparent; `.close-box::after` draws the smaller
System 7 square. Use the same pattern when a compact visual control still needs
a real 48px hit box. `bookskindle.html` also uses `data-no-scale`: global zoom
below 1 otherwise shrinks every nominal 48px control below the Kindle minimum.
Keep `#kindle-change-panel` outside `.content-area` as the compact, non-scrolling
footer above the status bar; the button remains 48px tall but must not regain
the full-width `.wide-button` class.

**Yandex service identity:** Yandex Foundation Models, Vision OCR, Object Storage, and other managed APIs should use the Cloud Function service-account token exposed as `context.token.access_token`. Keep the function's service-account roles minimal and pass `x-data-logging-enabled: false` for AI/OCR requests containing user content.

**AI Assistant production contract:** Shared AI usage is enforced only by the Yandex backend under `api_daily_limits/{uid}/ai_shared/{UTC-day}`. `chat.html` must read it with `POST /api/rekindle/ai/chat` and `{ "action": "quota" }`; never restore the client-writable Firestore `users/{uid}/chatLimits` counter. A shared request atomically reserves one message and must release that reservation if YandexGPT times out or fails, so provider failures do not consume the user's allowance. Successful shared responses and `daily-limit` errors include a `quota` object with `limit`, `used`, `remaining`, `day`, and `resetAt`.

**AI Assistant diagnostics and IAM:** Do not collapse every `/ai/chat` rejection into a network error. The frontend distinguishes Firebase session errors, the server daily limit, BYO provider authentication/rate errors, Yandex configuration/permissions, upstream capacity, and timeouts; backend errors include a safe `requestId` for log correlation. The Cloud Function's attached service account needs the folder-level `ai.languageModels.user` role in addition to invocation/secret/storage permissions. An unauthenticated `401` smoke test proves only routing and Firebase-token enforcement; production verification must make one authenticated shared prompt and confirm a non-empty answer plus a one-message quota decrement.

**Yandex CLI browser authentication gotcha:** On macOS, `yc init --no-browser` can wait for the OAuth callback without printing a usable authorization URL. Use `yc init --username=<account-email>` with the normal browser flow for deployment sessions. Do not enable `--debug` around authentication because its output can expose sensitive authentication details.

**Yandex Object Storage recursive-copy gotcha:** Yandex CLI 1.18.0 marks `yc storage s3` as preview. During the 15 July 2026 AI Assistant release, both `yc storage s3 cp <dir> s3://rekindle/ --recursive` commands returned exit code 0 but silently omitted the same alphabetical tail of the 113-object release (42 root HTML objects and aliases). Never accept a recursive-copy exit code as proof of a complete frontend deployment. Read the bucket back and compare every manifest object byte-for-byte; upload any missing objects individually with `yc storage s3api put-object`. Set extensionless page aliases to `Content-Type: text/html` explicitly and verify their public HTTP headers.

When assigning MIME types in a shell release loop, detect an extensionless alias
from its basename (`[[ "$base_name" != *.* ]]`). A broad glob intended to mean
"no extension" can also match `.js`, causing Object Storage to serve scripts as
`text/html`; smoke-test the public MIME type for HTML, JS, and `sw.js`.

**Concurrent frontend staging gotcha:**
`yandex/prepare-frontend-release.js` defaults to the shared
`/private/tmp/rekindle-yandex-release` directory. Parallel tasks can replace its
stage and zip between preparation and upload. Set a task-specific
`REKINDLE_YANDEX_RELEASE_DIR`, then recheck its object count immediately before
publishing.

**Parallel Object Storage readback gotcha:** With `xargs`, a literal `{}` is
not replaced unless `-I{}` is present. A command such as
`xargs -n1 sh -c '...' sh '{}' "$readback_dir"` therefore requests the object
key `{}` and reports false 404s for the whole release. Use
`xargs -0 -P12 -I{} sh -c '...' sh '{}' "$readback_dir"`, then compare every
downloaded file with its staged source.

**Service worker belongs in every static release:** `sw.js` was accidentally absent from `yandex/FRONTEND-RELEASE-MANIFEST.txt` during the 15 July 2026 social-removal rollout. The other 117 objects deployed correctly, but production kept `rekindle-cache-v21`, so existing browsers could continue serving the retired KindleChat catalog from cache. Keep `sw.js` in the manifest, increment `CACHE_NAME` whenever retiring cached pages, upload it with `Cache-Control: no-cache, max-age=0`, and verify both the direct bucket object and public website serve the new cache version.

**Dashboard weather contract:** Both `index.html` and `index_old.html` get the
current conditions, apparent temperature, and button-paged 24-hour forecast
from the generic Open-Meteo API. The first seven 30-day cards must also use
that generic daily response, matched by their `YYYY-MM-DD` value, so today's
temperature and weather code agree with the hourly forecast. Use the compact
EC46 ensemble mean from the Seasonal API only for later dates; if that request
fails, the existing seven generic daily values remain as a fallback. Keep the
modern and classic home-widget implementations synchronized. Use Open-Meteo's modern
`current=temperature_2m,apparent_temperature,weather_code` parameter; combining
it with legacy `current_weather=true` makes the API omit the `current` object.
The hourly response uses local wall-clock strings because the request specifies
`timezone=auto`; compare their `YYYY-MM-DDTHH` prefixes with `current.time` and
format the hour manually instead of applying another timezone conversion.
Hourly and daily paging changes `scrollLeft` directly (never use smooth
scrolling on E-ink), while disabled edge buttons remain in the grid with
`visibility: hidden` so the forecast cards do not shift. Keep all dashboard
weather labels in every main locale bundle when changing this widget.

**Dashboard agenda layout:** In `index.html`, today's complete agenda is shown
above the month grid, and the whole calendar widget precedes the weather
widget. Do not restore an inner `max-height` or `overflow-y` on
`.dashboard-agenda-list`: the outer dashboard owns scrolling so every meeting
remains visible. Meeting times use the existing manual 24-hour formatter. The
The dashboard loads the agenda automatically and intentionally has no manual
refresh button. Both `index.html` and `index_old.html` render weekday headers
and month offsets Monday-first.

**Worker-free frontend rule:** Production frontend code must not contain hard-coded `*.workers.dev` endpoints. Route Oracle, OCR, Reader, Reddit, Readwise, Akinator, Story, and Microsoft To Do through versioned paths on the Yandex API Gateway and keep the gateway base URL in one shared client module.

**Cross-service analytics contract:** ReKindle and TETRA browser events are sent
to `POST /api/rekindle/analytics/events`. The Yandex backend verifies the
production origin, maps it to the source ID, rate-limits the caller, and forwards
the sanitized event using `ANALYTICS_INGEST_TOKEN` from Lockbox. Never expose the
ingestion token in browser code. `theme.js` records page paths without query
strings; `js/rekindle-cloud.js` records only the HTTP method, normalized API
path, status, and duration. Do not add form bodies, credentials, authorization
codes, AI prompts, file content, or URL query strings to
analytics. A `theme.js` analytics change requires a query-version bump on every
root page plus a `sw.js` cache-name bump and full manifest deployment.

**Reddit feed preference contract:** Sorting preferences are per subreddit, not global. `reddit.html` stores the normalized map locally and in `users/{uid}/apps/reddit.feed_preferences`; keep the allowed values and URL/cache construction in `js/reddit-feed-settings.js`. Reddit's non-default feeds use `/r/{sub}/{sort}` and `top`/`controversial` add the `t` period. Every cache key must include subreddit, sort, and the applicable period so an offline fallback cannot display a different feed.

**Reddit Top 100 feed gotcha:** `/subreddits/popular.rss` can return community
links on either `old.reddit.com` or `www.reddit.com`. `parseTopSubreddits()` must
accept both hosts; matching only the old host intermittently renders an empty
Top 100 screen even though the proxy returned all 100 Atom entries.

**Retired Telegram integration (July 2026):** The MTProto page, client script,
backend service and dependency, API Gateway route, Firestore session rule,
catalog entry, locale contract, and static production objects were removed.
Do not recreate this integration or add Telegram application credentials.

**Microsoft To Do uses server-side OAuth device authorization:**
`microsofttodo.html` never loads MSAL, calls Microsoft Graph directly, or puts
access/refresh tokens in browser storage. The Kindle-friendly flow displays a
short device code from `/api/rekindle/microsoft-todo/start`; the user approves it
at `https://microsoft.com/devicelogin`, and the client polls the authenticated
Yandex route. This avoids PKCE/Web Crypto and modern MSAL compatibility problems
on Chromium 75 while still supporting personal and eligible work/school
Microsoft accounts. Keep the delegated scope at the least-privilege
`offline_access Tasks.ReadWrite` contract. Do not add application-wide
`Tasks.ReadWrite.All` access.

Microsoft refresh/access tokens and pending device codes live only in the
server-maintained top-level Firestore `microsoft_todo_sessions/{firebaseUid}`
documents, which have an explicit client deny rule in `firestore.rules`. Both
pending and connected state are encrypted with AES-256-GCM and UID-specific AAD
using the 32-byte base64 `MICROSOFT_TODO_SESSION_ENCRYPTION_KEY`. Production also
requires `MICROSOFT_TODO_CLIENT_ID`; `MICROSOFT_TODO_TENANT` is optional and
defaults to `common`. This is a public-client device flow and must not use or
store a Microsoft client secret. Task content remains in Microsoft To Do and is
returned through the allowlisted `/me/todo/lists` Graph paths only. Keep
`microsofttodo.html?demo=1` for full Kindle UI QA without Microsoft or Firebase
credentials.

**Yandex can omit Firebase Admin's Firestore implementation:**
`firebase-admin` declares `@google-cloud/firestore` as optional. A clean Yandex
Cloud Functions build may omit that package, causing either a runtime 500 when
`app.firestore()` is first called or a cold-start 502 such as `Cannot find
module '@google-cloud/firestore/build/src/path'`. Keep
`@google-cloud/firestore` as an explicit pinned dependency in
`yandex/rekindle-backend/package.json` and initialize it with
`require('firebase-admin/firestore').getFirestore(app)`. Verify both the health
route and an authenticated Firestore-backed route after every clean backend
build; a health-only check does not prove Firestore is installed.

**Build frontend releases from the current production Firebase web config:** a
cached release staging directory can contain an API key that has since been
rotated or restricted. Before running `prepare-frontend-release.js`, read the
currently deployed HTML object from the production bucket, validate its key
against Firebase Authentication from the production referrer, and use that
current value for placeholder replacement. Never treat an older file under
`/private/tmp/rekindle-yandex-release` as authoritative.

**Extensionless URL cleanup must preserve URL state:** `theme.js` removes the
`.html` suffix with `history.replaceState()`. The replacement URL must include
both `window.location.search` and `window.location.hash`; using only the cleaned
pathname silently drops parameters such as `?lang=ru` or OAuth state before
page scripts read them.

**Reddit is not covered by merely deleting its Pages Function:** `reddit.html` needs browser-like upstream headers and proxies Reddit-hosted images as well as RSS/JSON. It continues to use the dedicated Yandex Function behind `/api/reddit`, but derives the Gateway origin from `RekindleCloud.gatewayBase` instead of embedding another absolute URL. The handler validates a fixed Reddit/Imgur hostname allowlist, revalidates every redirect against the same allowlist, uses a bounded warm cache with stale fallback, and caps responses at 5 MB. Do not silently replace it with an unrestricted generic proxy.

**Privacy localization must describe the deployed architecture:** Do not repair stale privacy text by walking and rewriting the rendered DOM in `privacy.html`. Architecture and entitlement disclosures live in every `locales/privacy-*.json` file and must be updated at the source. After a migration, search all privacy locales for retired provider names, misleading collection descriptions, and obsolete subscriber-only wording, then validate every JSON file. The legacy `pro_data` collection name still exists for integrations but is owner-only data, not a subscription gate. References to `cdnjs.cloudflare.com` are CDN disclosures and are not Cloudflare Worker dependencies.

**Akinator frontend bug fixed during migration:** The former page called `fetch('${API_BASE}/start', ...)` inside ordinary single quotes, so `${API_BASE}` was sent literally rather than interpolated. Yandex routes now use `RekindleCloud.request('/games/akinator/...')`. Use string concatenation or a real backtick template literal when assembling legacy-browser URLs and include the page in the inline-script parse audit.

**Interactive Story is a separate Yandex Function:** `yandex/rekindle-story/index.js` runs the Z-machine interpreter in Yandex Functions and stores state under the `story-runtime/` Object Storage prefix. Production function `d4ehvm01ga7mfo9vuas6` is routed through the main gateway at `/api/rekindle/story/upload` and `/api/rekindle/story/play/{id}`. Keep `gateway-paths.template.yaml` and the main gateway spec synchronized if the function is replaced.

**Story upload bounds:** The Yandex Story wrapper rejects request bodies above 3 MB and the engine rejects decoded Z-code above 2 MB before writing to Object Storage. Preserve both checks: the outer limit bounds JSON/base64 memory use, while the inner limit bounds the actual stored game. New metadata uses `storyServiceUrl`/`hasServerStory`; `interactive.html` reads the old `storyWorkerUrl`/`hasWorkerStory` keys only to keep existing local libraries compatible.

**Story runtime entrypoint and generated CSS:** Yandex Cloud resolves the Story entrypoint `index.handler` from `yandex/rekindle-story/index.js`; keeping only `index.mjs` produces a runtime 502 even when `package.json` uses `"type": "module"`. The generated play page in `story-engine.mjs` must also follow Kindle rendering limits: use a sibling margin instead of flex `gap`, and keep the controls container in normal document flow rather than `position: sticky`.

**Reader dependency pin:** Keep `linkedom` pinned to `0.16.11` in the CommonJS Yandex backend. `0.18.13` pulls an ESM-only `css-select` into its CommonJS entry and fails with `ERR_REQUIRE_ESM`. Test the actual `require('@mozilla/readability'); require('linkedom')` path after dependency updates, not only auth-gated unit tests.

### 11. RTDB Turn Timers and `ServerValue.TIMESTAMP` Placeholders
When building turn-based multiplayer games with RTDB, store `turnStartedAt` using `firebase.database.ServerValue.TIMESTAMP` so all clients share the same clock.

**Gotcha:** After a local write, the RTDB value listener may fire before the server resolves the timestamp. The local snapshot then contains the sentinel object `{ '.sv': 'timestamp' }` (or an estimated value), not a number. Computing `Date.now() - turnStartedAt` against this placeholder produces `NaN`, which causes `setTimeout(..., NaN)` to fire immediately or with a browser-default delay.

**Solution:** Guard timer scheduling until the timestamp is a real number:

```javascript
const turnStartedAt = gameState.turnStartedAt;
if (typeof turnStartedAt !== 'number') return; // Wait for server confirmation

const elapsed = Date.now() - turnStartedAt;
const remaining = Math.max(1000, AFK_TIMEOUT_MS - elapsed);
afkTimer = setTimeout(performAfkAction, remaining);
```

This pattern is used in `liveuno.html` for the 30-second AFK auto-skip timer.

**Clock skew:** `Date.now()` on the Kindle experimental browser can be minutes or hours off from the Firebase RTDB server clock. Always use `rtdb.ref('.info/serverTimeOffset')` to compute a client-side estimate of the server time before comparing against a `ServerValue.TIMESTAMP` value. If you set turn deadlines (e.g., `roundEndsAt`) from the client, set them with the server-time estimate so every client/host evaluates them consistently.

```javascript
let serverTimeOffset = 0;
rtdb.ref('.info/serverTimeOffset').on('value', snap => { serverTimeOffset = snap.val() || 0; });
function serverTime() { return Date.now() + serverTimeOffset; }

// Reading
const elapsed = serverTime() - gameState.turnStartedAt;

// Writing
matchRef.update({ roundEndsAt: serverTime() + 80000 });
```

### 12. Host Migration in RTDB Multiplayer Games
Do **not** remove the entire game node when the host disconnects. A brief network hiccup would destroy the match and kick every player out.

**Pattern:**
1. Set `matchmaking/{game}/{matchId}.onDisconnect().remove()` only for the public listing.
2. Do **not** set `games/{game}/{matchId}.onDisconnect().remove()`.
3. In the `matchRef.on('value')` listener, detect when `gameState.host` no longer exists in `gameState.players`. If so, promote the oldest remaining human player to host and update both the game node and the matchmaking listing:

```javascript
if (!gameState.players[gameState.host]) {
    const humans = Object.entries(gameState.players || {})
        .filter(([uid, p]) => !p.isBot)
        .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (humans.length > 0 && humans[0][0] === currentUser.uid) {
        const newHost = humans[0][0];
        matchRef.update({ host: newHost });
        rtdb.ref(`matchmaking/{game}/${matchId}`).update({
            hostUid: newHost,
            hostName: gameState.players[newHost].name
        });
    }
}
```

This keeps the game alive if the host leaves or drops, and lets remaining players finish the match. It is implemented in `liveuno.html`.

### Akinator API (`akinator.html`)
The Akinator game is served by `yandex/rekindle-backend/index.js` through `/api/rekindle/games/akinator/{action}` on the Yandex API Gateway. `akinator.html` calls it through `RekindleCloud.request()` and sends a Firebase ID token.

Important notes:
- Akinator.com sits behind Cloudflare bot protection; server-side calls can be blocked if the upstream IP/headers are flagged.
- The start endpoint scrapes the Akinator `/game` page. Reliable patterns are:
  - `session: '...'` (inline JS)
  - `signature: '...'` (inline JS)
  - `<p class="question-text" id="question-label">...</p>`
  - Answer labels from `<a class="li-game" href="#" id="a_yes" onclick="chooseAnswer(0)">...</a>` (and `a_no`, `a_dont_know`, `a_probably`, `a_probaly_not`).
- Action endpoints: `/answer` (send 0-4), `/cancel_answer` (back), `/exclude` (continue after wrong guess).
- Supported regions and theme `sid` values: characters=1, objects=2, animals=14.

## 🌐 External API Proxies (Rate-limiting)

### Static Yandex hosting requires Gateway API routes

The production site at `https://rekindle.website.yandexcloud.net` is static hosting. A relative `/api/...` request falls through to the static-site error document. All APIs must use an absolute Yandex Gateway URL.

**Object Storage HTTPS-enforcement gotcha:** Do not put an
`aws:SecureTransport` deny policy on the `rekindle` static website bucket.
Yandex's website proxy evaluates that condition on its internal hop, so the
policy returns `403` for external HTTPS as well as HTTP. The default
`*.website.yandexcloud.net` hostname has no configurable HTTP-to-HTTPS redirect;
true HTTPS-only hosting requires an edge/custom domain that sees the original
protocol. `theme.js` provides a best-effort same-host upgrade for ordinary HTTP
visits before reading origin-scoped state; keep it restricted to the exact
production hostname so local HTTP development still works. Client-side
redirects are not a security boundary. After any edge, theme, or bucket-policy
change, smoke-test both schemes before testing application flows.

The shared public GET/HEAD proxy is `/api/rekindle/content/proxy?url=...`. It validates public DNS destinations, rejects credentials/private networks, follows at most five validated redirects, applies an IP rate limit, strips browser credentials and cookies, and caps responses at 5 MB. Do not weaken it into an unrestricted header-forwarding proxy. `reddit.html` continues to use its dedicated Yandex route because Reddit needs its own allowlist/cache behavior.

**Remote RSS image gotcha:** `rss2json` can return valid BBC thumbnail URLs on
`ichef.bbci.co.uk` even when that CDN is unreachable from the user's network.
Do not put those URLs directly into `<img src>`. `newspaper.html` sends remote
HTTP(S) thumbnails through `RekindleCloud.apiBase + '/content/proxy?url='` and
keeps `.article-img` hidden until `onload`, hiding it again on `onerror`. The
same upstream image was verified to time out directly while the deployed
Yandex proxy returned `200 image/jpeg`.

**Firebase Auth restoration race:** On a cold page load,
`firebase.auth().currentUser` can still be `null` while the compat SDK restores
the persisted session. A synchronous null check incorrectly reports “Please
sign in first”; a second click then works after restoration finishes.
`js/rekindle-cloud.js` therefore waits for the first `onAuthStateChanged`
result before rejecting an authenticated request. Keep the immediate
`currentUser` fast path, the bounded initialization timeout, and the true
signed-out rejection. The regression contract is
`tests/newspaper-reliability.test.js`.

**Kindle dashboard login ordering:** `index.html` and `index_old.html` must set
Firebase Auth `LOCAL` persistence and keep the login modal open until
`RekindleIpBan.checkOnLogin()` succeeds. The auth-state callback can fire as
soon as Firebase accepts the password; closing the modal there makes a later
security-check failure look like a page refresh. If that check fails, sign the
new session out and leave the error visible.

**Reddit's current Yandex deployment:** `yandex/reddit-function/index.js` runs as the public Node.js 22 Cloud Function `rekindle-reddit` (`d4egfe65qmv2774tec7m`). The `rekindle-api` API Gateway (`d5dmoqrf9kg552lo4g69`) exposes it at `https://d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net/api/reddit`. `reddit.html` uses this absolute endpoint for both feeds and images. The checked-in Gateway specification is `yandex/reddit-api-gateway.yaml`.

**Yandex console Monaco gotcha:** Calling automation-style `fill()` on the Cloud Functions or API Gateway Monaco editor can insert the new source without deleting the generated sample. If the sample contains a second `module.exports.handler`, it silently overrides the intended handler. Focus the `textarea[aria-label="Editor content"]`, send `ControlOrMeta+A`, then type the complete source. Before saving, verify that `Hello World` is absent and that the visible final line number matches the source file.

**Extensionless Yandex Object Storage URLs:** The static website does not rewrite `/reddit` to `/reddit.html`. If only `reddit.html` exists, `/reddit` returns the configured error document with HTTP `404`, even though the browser may display ReKindle HTML. The production deployment therefore stores the same Reddit page under both object keys: `reddit.html` and `reddit`. Whenever `reddit.html` changes, upload both objects. This was verified on July 13, 2026: `/reddit` returns HTTP `200` and loads 25 posts through the Yandex Gateway.

**Safe bulk Firebase-config rollout:** Never upload every dirty local HTML file
just to change Firebase projects; that can publish unrelated unfinished work.
`yandex/prepare-firebase-config-release.js` downloads the live production HTML,
performs only the exact old-to-fork Firebase substitutions,
creates the required extensionless aliases, and emits a SHA-256 manifest in
`/private/tmp/rekindle-firebase-config-release`. Publish only those generated
objects after explicit approval for the broad production change, then audit
both `.html` and extensionless URLs for any remaining upstream project ID.

### Firebase Auth on new deployment domains

The primary Firebase web API key is restricted by HTTP referrer. When a new production hostname is introduced, login and registration can fail before credentials are checked with an error such as `auth/requests-from-referer-https://HOST-are-blocked`. This is an API-key website-restriction error, not a bad-password error and not something that can be fixed in the page JavaScript.

For `https://rekindle.website.yandexcloud.net`, add both `https://rekindle.website.yandexcloud.net` and `https://rekindle.website.yandexcloud.net/*` to the key's Website/HTTP-referrer allowlist in Google Cloud Console. Preserve all existing referrers and API restrictions. Also add the hostname-only value `rekindle.website.yandexcloud.net` to Firebase Authentication's Authorized domains list so future redirect-based auth flows work. Apply this checklist to every new deployment hostname.

For an independent fork that cannot change the original project's allowlists, a new Firebase project and web-app configuration are required. Replacing only `apiKey` is insufficient: replace the complete config (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and every explicit `databaseURL`). Login then calls the callable function `checkIPOnLogin`, while registration calls `registerUser`; either deploy the fork's `firebase-functions/` and add the fork's origin to `allowedOrigins` in `firebase-functions/index.js`, or deliberately replace/remove these calls and accept the loss of server-side IP-ban enforcement. The full application also requires the matching Firestore, RTDB, and Storage rules. ReKindle uses one Firebase project; do not add a second project for retired social features.

**This fork's no-Blaze backend:** `rekindle-fork` keeps Firebase Authentication,
Firestore, and RTDB on Spark. Registration, login IP checks, and private cloud
files are handled by `yandex/rekindle-backend/index.js` through the routes in
`yandex/rekindle-api-gateway.yaml`; files live in a private Yandex Object
Storage bucket and are transferred with five-minute signed URLs. Secrets are
in Yandex Lockbox, never browser code. `js/rekindle-cloud.js` is the shared
browser client. Login must fail closed: if Firebase accepts credentials but
the Yandex IP-check request fails, sign the new session out instead of allowing
an unchecked login. The combined Gateway specification must retain the Reddit
proxy's `GET` and `HEAD` methods and public CORS behavior; the backend itself
enforces the stricter ReKindle-origin allowlist.

Do not reuse the Firebase browser API key for unrelated Google APIs. The fork's
key is intentionally restricted to Firebase APIs and the production HTTP
referrer. Use a dedicated credential or a server-side proxy when an application
needs a non-Firebase Google API.

**Production Auth E2E gotcha:** the restricted Firebase web API key rejects
server-side Identity Toolkit calls that do not contain the allowed website
referrer, even when the custom token is valid. The production test at
`yandex/rekindle-backend/e2e-production.js` therefore sends
`Referer: https://rekindle.website.yandexcloud.net/` when exchanging a custom
token. This mirrors the browser request and tests the referrer restriction
instead of weakening it. The Identity Toolkit custom-token response may omit
`localId`; derive the UID from the returned ID token's `user_id`/`sub` claim.

External APIs such as Reddit aggressively rate-limit shared cloud egress IPs. Yandex proxy handlers should:

- Use a bounded warm-instance cache for small public responses, or YDB/Object Storage when caching must be shared across instances.
- Retry on `429 Too Many Requests` and `5xx` errors with exponential backoff, respecting any `Retry-After` header.
- Return stale cached data to the client when the upstream is rate-limiting, so the UI doesn't appear broken.
- Use different cache TTLs by content type (e.g., 60 s for RSS feeds, 5 min for images).

Use `yandex/reddit-function/index.js` and the public proxy in `yandex/rekindle-backend/index.js` as production patterns.

### Guarding Optional Firebase / CDN Dependencies
If an app can function without Firebase (e.g., local-only games), wrap Firebase initialization and all `auth`/`db` usage in feature checks. A blocked or failed CDN script must not prevent the rest of the page script from running. Use `typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && typeof firebase.firestore === 'function'` before initializing, and guard every `db.collection(...)` / `auth.onAuthStateChanged(...)` call. See `nonograms.html` for the pattern used in this codebase.

## Firebase web API key rotation

Firebase web API keys are public project identifiers, not authorization
secrets; Firebase Security Rules and App Check protect data. Generic GitHub
secret scanning may still flag a literal `AIza...` value. Source files therefore
use the placeholder `__REKINDLE_FIREBASE_API_KEY__`. `build-automation.js`
requires `REKINDLE_FIREBASE_API_KEY` and injects it only into build artifacts.
Never commit the concrete value or replace the placeholder in source files.

For a Yandex config-only rotation, run
`yandex/prepare-firebase-config-release.js` with `REKINDLE_FIREBASE_API_KEY`
supplied outside Git. Supply `REKINDLE_CURRENT_FIREBASE_API_KEY` as well when
rotating an existing concrete key. The script also repairs a mistakenly
published `__REKINDLE_FIREBASE_API_KEY__` placeholder. Publish and verify the
generated production objects before deleting the old Google Cloud API key;
deleting it first breaks Firebase Auth immediately.

**Yandex frontend release key injection:** Never upload checked-in HTML files
directly to the public bucket. `yandex/prepare-frontend-release.js` requires
`REKINDLE_FIREBASE_API_KEY`, injects it only into the staged archive, copies the
injected bytes to extensionless aliases, and fails if any release object still
contains `__REKINDLE_FIREBASE_API_KEY__`. Publishing raw source produces
`auth/api-key-not-valid` on every primary Firebase login and data operation.

## Git Workflow

**Exchange Calendar session-storage gotcha:** Yandex-to-Firestore requests can
stall until the function timeout. Encrypted Exchange credentials therefore live
in the private Object Storage prefix
`integrations/exchange-calendar-sessions/`, accessed through
`getExchangeCalendarSessionDocument()` in the shared backend. Keep the single
retry in `readSessionDocument()` for transient Object Storage failures. Do not
move this request path back to Firestore.

The dashboard must distinguish `exchange-calendar-not-connected` from an
outage. Render the localized 48px `calendar.html` connect action for that code;
reserve `calendar.exchange.reconnect` for actual request failures. A saved
Exchange provider preference can outlive its encrypted server session.

**Yandex Firestore transport gotcha:** The shared backend's default gRPC/HTTP2
Firestore transport can hang until the 30-second function timeout, affecting
Exchange Calendar and both Kindle worker queues at once. All backend Firestore
callers must go through `getBackendFirestore()` in
`yandex/rekindle-backend/index.js`, which initializes Firebase Admin with
`preferRest: true`. Do not restore direct `getFirestore()` calls.

**Yandex Firebase token-verification gotcha:** Do not pass `true` as the second
argument to `verifyIdToken()` in the shared Yandex backend. That enables a
remote revocation lookup on every authenticated request; the lookup can hang
until the function's 30-second timeout and make Exchange Calendar appear
offline before its handler runs. Verify the signed token locally and rely on
its short expiry, as the existing backend routes do.

**Dashboard login wall:** `index.html` and `index_old.html` keep the existing
`#login-modal` hidden until Firebase resolves, then `requireLogin()` opens it
only for signed-out or offline users. Keep both dashboards synchronized: the
wall must have no cancel action, and `closeModal()` must refuse to hide it
without `auth.currentUser`. Bump the `sw.js` cache when changing the wall so the
precached dashboard cannot preserve stale auth behavior offline. This is a
client-side interface gate; data access still belongs in Firebase rules and
authenticated Yandex routes.

After successfully completing any task that changes code:

1. Review the changes and run the relevant tests.
2. Stage only the files that belong to the current task. Never include unrelated user changes.
3. Create a concise, descriptive commit directly on the `main` branch.
4. Run `git push origin main` automatically without asking for additional confirmation.
5. Do not create a separate branch or Pull Request unless the user explicitly requests one.
6. Do not push if tests fail, secrets are detected, GitHub authentication is unavailable, or the intended changes cannot be safely separated from unrelated work. Report the blocker instead.
7. If GitHub rejects a direct push because `main` is protected, create a `codex/<short-task-name>` branch and a Pull Request, then report the restriction.

**Books search polling:** Search jobs poll every 2 seconds; delivery stays at 8 seconds. Keep `refreshPending` guarding status calls so a slow Gateway cannot create overlapping requests. `bookskindle.js?v=11` carries this change.

Books E2E latency is recorded by the page on `#job-panel[data-search-duration-ms]`, from submitting a valid query to rendering its terminal state. Read this DOM value instead of timing spaced browser observations. Reset it on a new search; keep the first terminal measurement stable. The value is local to the page, not sent as telemetry.

Books search has its own 60/hour user bucket; delivery retains 20/hour. HTTP 429 must be displayed as a request limit, and errors must replace the searching status.

Books status with an explicit job ID must read that document directly and verify ownership, never search a limited history. History queries select the newest createdAt records, not the first UUIDs.
