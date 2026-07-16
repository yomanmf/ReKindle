# Kindle Browser Compatibility Guide

**CRITICAL:** When developing for this project, you must adhere to the following constraints to ensure compatibility with Kindle and E-ink browsers.

## 📝 Agent Documentation Rule

**This file is a living document.** Whenever you fix an issue, discover a gotcha, uncover a cross-page CSS leak, or learn anything about this codebase that isn't already written here, **add it immediately**.

Future agents (including yourself in a new session) will not have access to your working context. If you don't write it down, the knowledge is lost. Be generous with details, code snippets, and file paths. A few minutes of documentation now saves hours of re-discovery later.

## Mandatory GitHub Delivery Rule

**A task is not finished until its completed, verified changes are committed and pushed directly to `origin/main`.** Do this automatically at the end of every task; do not leave the result only in the working tree, a local commit, or a separate remote branch, and do not wait for an additional reminder to push.

* Include every change that belongs to the task, including deletions, migrations, rules, documentation, and related application changes. Exclude something only when the user explicitly asks for that exclusion.
* Run the relevant tests and `git diff --check` before committing.
* Fetch `origin/main` before publishing and use a normal fast-forward push. Never force-push or discard unrelated user changes. If upstream changes prevent a safe fast-forward, integrate them without data loss, rerun verification, and then push.
* After pushing, verify that `origin/main` points to the new commit and that the working tree contains no uncommitted task changes.
* If authentication, branch protection, a merge conflict, or another external restriction prevents the push, report that blocker explicitly; a local or feature-branch commit does not count as delivery.

## 🚫 Restrictions (Target: Chromium 75)

### 1. No Flexbox Gap (`gap`)
**Constraint:** Chromium 75 supports `gap` for **CSS Grid** but **NOT for Flexbox** (added in Chrome 84).
**Solution:**
*   **Flex Containers:** Use **Margins** (`margin-left` / `margin-top` on siblings).
*   **Grid Containers:** You **CAN** use `gap`. Prefer CSS Grid for layouts requiring gutters.

**Example (Correct):**
```css
/* OK in Grid */
.grid-box { display: grid; gap: 10px; }

/* BROKEN in Flex (Do NOT use) */
.flex-box { display: flex; gap: 10px; }
```

### 2. JavaScript Limits (ES2019 Ceiling)
**Constraint:** The browser supports up to **ES2019**.
**BANNED Syntax (ES2020+):**
*   ❌ Optional Chaining (`?.`) -> `user?.name` will **CRASH** the app.
*   ❌ Nullish Coalescing (`??`) -> `val ?? default` will **CRASH** the app.
*   ✅ `async`/`await`, `Promises`, `Arrow Functions` are **SAFE**.

### 3. Typography & Emojis
1.  **System Fonts (`Arial`, `Verdana`, `Courier New`, `serif`, `sans-serif`) are required.**
2.  Do not include web fonts (e.g., `@import url('https://fonts...')`); it delays render times drastically.
3.  **NO EMOJIS**: The Kindle experimental browser does not support Unicode emojis. They will render as broken square boxes (`[]`).
    - Use System 7 retro ASCII emoticons instead: `:)`, `:D`, `T_T`, `:|`, `:(`.
    - Or use manually drawn SVGs if an icon is required.

### 4. No Animations / Transitions
**Constraint:** E-ink displays run at ~7-15fps. CSS animations cause severe ghosting and flashing.
**Solution:** **Disable all animations.**
```css
* {
    transition: none !important;
    animation: none !important;
}
```

### 4. No Alerts (`alert()`)
**Constraint:** `window.alert()`, `confirm()`, and `prompt()` are unsupported.
**Solution:** Use **Custom Modals** (HTML/CSS overlays).

**Example (Correct):**
```html
<!-- Use a custom div overlay -->
<div id="custom-alert" class="modal-overlay">
  <div class="modal-box">
    <p>Operation failed.</p>
    <button onclick="closeModal()">OK</button>
  </div>
</div>
```

## 🎨 Standard UI Patterns (System 7)

All applications must adhere to the following strict HTML/CSS patterns to maintain the "Retro OS" look.

### 1. The Environment (`body`)
The body acts as the "desktop" background. It handles the centering of the application window.
```css
body {
    background-color: #e5e5e5; /* Desktop Gray */
    font-family: "Geneva", "Verdana", sans-serif;
    image-rendering: pixelated; /* CRITICAL for crisp edges */
    margin: 0;
    height: 100vh;
    overflow: hidden; /* Prevent body scroll */
    
    /* Center the App Window */
    display: flex; 
    align-items: center; 
    justify-content: center;
}
```

### 2. The Window (`.window`)
The main container for every app.
```css
:root {
    --shadow: 4px 4px 0px #000000;
}

.window {
    background: white;
    border: 2px solid black;
    box-shadow: var(--shadow); /* Hard, non-blurred shadow */
    width: 95%;
    max-width: 600px; /* Standard Tablet Width */
    height: 90vh; /* Or fit-content */
    display: flex;
    flex-direction: column;
    position: relative;
}
```

**Content-area gotcha:** `theme.js` injects `.window { max-height: 95vh !important; }` (scaled down at higher zoom levels). Use `height: 90vh` when you want a fixed-height window with a viewport gap; if you use `min-height: 90vh` instead, the window can grow to the theme.js `max-height` and lose the gap. For content pages that should shrink to their content and only scroll when content is long, use `height: fit-content` and `flex: 0 1 auto; min-height: 0;` on the scrollable child instead of `flex-grow: 1`.

### 3. The Title Bar (`.title-bar`)
**Mandatory Structure:** The title bar uses a specific layered technique to achieve the "text on stripes" look.

**HTML:**
```html
<div class="title-bar">
    <div class="title-stripes"></div>
    <div class="close-box" onclick="window.location.href='index'">X</div>
    <span class="title-text" data-i18n="app.title">My App</span>
</div>
```

**CSS:**
```css
:root {
    --stripe-pattern: repeating-linear-gradient(0deg, transparent, transparent 2px, #000 3px, #000 4px);
}

.title-bar {
    height: 35px;
    border-bottom: 2px solid black;
    display: flex;
    align-items: center;
    justify-content: center;
    background: white;
    position: relative; /* Context for absolute children */
}

/* The Striped Background Layer */
.title-stripes {
    position: absolute;
    top: 4px; bottom: 4px; left: 4px; right: 4px;
    background-image: var(--stripe-pattern);
    z-index: 0;
}

/* The centered text with white background blocking stripes */
.title-text {
    background: white;
    padding: 0 15px;
    font-weight: bold;
    font-size: 1.1rem;
    z-index: 1; /* Sits above stripes */
    display: inline-flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
}

/* Standard Close Button */
.close-box {
    position: absolute;
    left: 10px;
    width: 18px; height: 18px;
    border: 2px solid black;
    background: white;
    z-index: 2; /* Sits above everything */
    box-shadow: 2px 2px 0 black;
    cursor: pointer;
    /* Flex center content "X" */
    display: flex; align-items: center; justify-content: center;
}
```

### 4. Interactive Elements
Buttons and inputs share a "tactile" 2px border style.

*   **Buttons:** `border: 2px solid black`, `box-shadow: 2px 2px 0 black`.
    *   *Active State:* `transform: translate(2px, 2px)`, `box-shadow: none`, `background: black`, `color: white`.
*   **Inputs:** `border: 2px solid black`, `border-radius: 0`, `font-family: inherit`.

### 5. Z-Index Layering
Strict layering constants to prevent overlap issues.

| Component | Z-Index | Notes |
| :--- | :--- | :--- |
| `title-stripes` | `0` | Background pattern |
| `title-text` | `1` | Sits above stripes |
| `close-box` | `2` | Interactive top layer |
| `modal-overlay` | `10000` | Always top-most |

**Stacking-context trap:** A modal overlay must be a direct child of `<body>` (or outside any ancestor with `position: relative` + `z-index`) to actually reach `10000`. In `index.html`, `.desktop-wrapper` has `position: relative; z-index: 1`, which creates a stacking context. An overlay inside it cannot rise above the top menu bar (`.sys-menu-bar`, `z-index: 1000`), so the dim background only covers the dashboard. If the overlay is trapped, move the modal nodes to `<body>` or remove the ancestor's `z-index`.

### 6. Injected UI from Shared Scripts
When creating modals or popups dynamically from shared JavaScript (e.g., `time.js`, `theme.js`), you should reuse the standard System 7 class names (`.window`, `.title-bar`, `.title-text`, etc.) to maintain the retro aesthetic. **However**, the 120+ HTML files in this project each have their own styles for these classes, and some add properties that are **not** part of the canonical pattern above (e.g., `index.html` adds `border: 2px solid black` to `.title-text`).

**Rule:** Always scope your injected selectors and explicitly reset any property that isn't defined in the canonical pattern:

```css
#my-modal .title-text {
    /* Canonical properties from section 3 */
    background: white;
    padding: 0 15px;
    font-weight: bold;
    font-size: 1.1rem;
    z-index: 1;
    /* Explicit resets for page-level overrides */
    border: none;
    display: inline-flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
}
```

Without these resets, host-page styles will leak into your injected modal.

### 7. Branding & Badges
Standardized "Beta" or status badges.

**Beta Badge:**
```css
.beta-badge {
    font-size: 0.6rem;
    margin-left: 5px;
    border: 1px solid black;
    padding: 1px 3px;
    font-weight: bold;
    font-family: sans-serif;
    vertical-align: text-top;
    display: inline-block;
    background: white;
    color: black;
}
```

## 🌍 Localization (i18n.js)

The project uses a custom `i18n.js` loader.

### Attributes
| Attribute | Usage |
| :--- | :--- |
| `data-i18n="key"` | Sets `innerText` |
| `data-i18n-html="key"` | Sets `innerHTML` (Careful with XSS) |
| `data-i18n-placeholder="key"` | Sets input `placeholder` |
| `data-i18n-title="key"` | Sets element `title` tooltip |
| `data-i18n-only="lang"` | Shows element **only** for specific lang code (e.g., "en") |

### Variable Interpolation

The `i18n.js` loader only does simple key lookup; **it does NOT interpolate variables**. Locale values use `${key}` placeholders (e.g. `"${pName}: Place ${ship} (${size})"`), but calling `window.t('key', { pName: ... })` will return the raw placeholder string unchanged. In dynamic code, fetch the template first and then replace placeholders manually:

```javascript
var template = window.t ? window.t('battleship.setup.msg') : '${pName}: Place ${ship} (${size})';
var text = template.replace('${pName}', 'You').replace('${ship}', shipName).replace('${size}', shipDef.size);
```

Or use a small helper that replaces all `${key}` occurrences. Many existing HTML files incorrectly pass a variables object as the second argument to `window.t()`, which silently fails on the Kindle browser.

### Icons (SVG)
Icons are stored as raw SVG strings in `icons.js`.
*   **Size:** Designed for **32x32** pixel grid.
*   **Stroke:** `stroke-width="2"` (Standard) or `"1.5"` for detail.
*   **Style:** `fill="none"` `stroke="black"` OR `fill="black"` `stroke="none"`.

## JavaScript Global `t` Naming Conflict

Do **not** define a global `function t(key, fallback)` in page scripts. `js/i18n.js` already exposes the translation helper as `window.t`. Because a global `function t` declaration also attaches itself to `window.t`, it overwrites the i18n helper and calls itself recursively, causing a `RangeError: Maximum call stack size exceeded`.

**Example of broken code (`akinator.html` before fix):**
```javascript
function t(key, fallback) {
    if (typeof window.t === 'function') {
        return window.t(key, fallback || key); // window.t is itself, infinite loop
    }
    return fallback || key;
}
```

**Fix:** Use a different local name (e.g., `translate`) and call `window.t` inside it, or use `window.t` directly with a fallback guard.
```javascript
function translate(key, fallback) {
    if (typeof window.t === 'function') {
        return window.t(key, fallback || key);
    }
    return fallback || key;
}
```

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
*   **RTDB Rules:** `rtdb-rules.json` — private user state, presence, multiplayer, Suggestions and API rate-limit data. There is no Pro gate.
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

**Firestore overlapping-match gotcha:** Security-rule `match` blocks are ORed, not ordered by specificity. A restrictive exact match does not override a broader permissive match. For example, both `match /privateSettings/ai` and `match /privateSettings/{docId}` match the `ai` document; if the wildcard rule allows the owner unconditionally, the intended ReKindle+ check in the exact rule is ineffective. Put the conditional in the wildcard rule (for example, branch on `docId == 'ai'`) or exclude the sensitive document from the broad allow. Audit other exact-plus-wildcard pairs the same way.

**Removing a client paywall does not create backend access control:** CORS is not authentication and can be bypassed by non-browser clients. The Yandex routes for AI, OCR, mail, Pinterest, Substack, Files, Docs, and Photo Frame therefore verify a primary Firebase ID token and enforce server-side per-user rate limits or storage quotas. Files, Docs, and Photo Frame are open to every authenticated user while retaining path ownership, MIME/type validation, 100 MB per-user storage, and 25 MB per-object limits. Direct Firebase Storage is deliberately denied by `storage.rules`; it has no byte-quota mechanism and must not be reopened as a shortcut.

**Yandex-only production architecture:** Browser code must call Yandex Cloud Functions through the `rekindle-api` API Gateway. Cloudflare Worker sources and Wrangler manifests have been removed. Do not restore their endpoints or patch old CORS allowlists. A new server route must be implemented and tested in Yandex before its frontend is published.

**Oracle custom-provider routing:** The old Worker ignored the provider-specific `endpoint` from `chat.html` and always called OpenAI. The Yandex implementation in `yandex/rekindle-backend/index.js` fixes this with an explicit provider endpoint allowlist. Keep model listing and inference on the same validated endpoint policy, and never allow loopback, link-local, or private-network targets.

**Paywall removal state (July 2026):** Dashboard interception and application-level ReKindle+ access checks have been removed. No app registry entry uses `plus: true`. ReKindle+ supporter data may remain for cosmetic profile badges and historical billing records; it must not control app launch, export, feed count, categories, storage, AI, OCR, or mail access. When adding an app, do not recreate `pro-gate.js` or introduce an `app.plus` access branch.

**Supporter badges must not trust profile fields or local storage:** Cosmetic supporter styling must come from the server-maintained `config/supporters` document (or equivalent trusted billing record). Never read a self-writable profile field such as `kindlePlus`, and never infer supporter status from `localStorage`.

**Retired internal social subsystem (July 2026):** The separate
`rekindle-socials` Firebase project is no longer part of the application.
KindleChat, Neighbourhood, Topics, Moderation, age verification, social custom
tokens, public profile cards, and their moderation/translation/reporting routes
were removed. Do not recreate their pages, Firebase configuration, rules,
callables, Gateway routes, locale keys, or admin scripts.

Pixel and Flipbook remain standalone creative tools. Pixel stores signed-in
cloud drawings in the primary Firestore `pixel_drawings` collection; Flipbook
uses primary Firestore `flipnote_animations`. Neither tool posts into a feed or
depends on RTDB. The dashboard and multiplayer games use deterministic
UID-derived avatar seeds instead of public profile cards. Life stores birthdays
owner-only at primary RTDB `users_private/{uid}/life/birthday`.

The frontend release manifest includes `pixel.html` and `flipbook.html`. The
delete manifest includes both HTML and extensionless object keys for the four
retired social pages so stale production URLs are removed after rollout.
Before publishing the primary RTDB rules, run
`admin/retire-public-profiles.js` without arguments to audit the migration and
then with `--force`: it preserves valid Life birthdays under the private path
before removing the obsolete `users_public` and `user_cards` trees.

**Removing a paywall includes its locale contract:** When a gated component is deleted, remove its unused translation keys too. Stale keys such as `airtype.paywall.*`, `mail.paywall.*`, `mail.pro.*`, `quicknotes.paywall.*`, `quicktodo.pro.*`, and `paywall.popup.*` previously continued to advertise exclusive apps and could be resurrected by cached or legacy markup. The remaining `pay.desc` and `support.desc` text must explicitly state that every app is available without a subscription. `news.error.paywall` is unrelated: it describes an external publisher's article paywall.

**OCR MIME must match the canvas encoding:** Quick ToDo and Quick Notes encode cropped handwriting with `canvas.toDataURL('image/jpeg', ...)`. Their Yandex OCR request must send `mimeType: 'JPEG'`; hard-coding `PNG` in the backend produces invalid or unreliable recognition. The backend accepts only `PNG` and `JPEG` and forwards the validated value to Yandex Vision OCR.

**Mail proxy SSRF rule:** IMAP and SMTP hosts are user-controlled input. The Yandex mail route must validate host syntax, restrict ports, resolve DNS, reject loopback/link-local/private IPv4 and IPv6 destinations, cap credential/message sizes, and apply connection timeouts before opening a socket. Authentication and per-user rate limits are still required. Never log mailbox passwords or access tokens.

**Yandex service identity:** Yandex Foundation Models, Vision OCR, Object Storage, and other managed APIs should use the Cloud Function service-account token exposed as `context.token.access_token`. Keep the function's service-account roles minimal and pass `x-data-logging-enabled: false` for AI/OCR requests containing user content.

**AI Assistant production contract:** Shared AI usage is enforced only by the Yandex backend under `api_daily_limits/{uid}/ai_shared/{UTC-day}`. `chat.html` must read it with `POST /api/rekindle/ai/chat` and `{ "action": "quota" }`; never restore the client-writable Firestore `users/{uid}/chatLimits` counter. A shared request atomically reserves one message and must release that reservation if YandexGPT times out or fails, so provider failures do not consume the user's allowance. Successful shared responses and `daily-limit` errors include a `quota` object with `limit`, `used`, `remaining`, `day`, and `resetAt`.

**AI Assistant diagnostics and IAM:** Do not collapse every `/ai/chat` rejection into a network error. The frontend distinguishes Firebase session errors, the server daily limit, BYO provider authentication/rate errors, Yandex configuration/permissions, upstream capacity, and timeouts; backend errors include a safe `requestId` for log correlation. The Cloud Function's attached service account needs the folder-level `ai.languageModels.user` role in addition to invocation/secret/storage permissions. An unauthenticated `401` smoke test proves only routing and Firebase-token enforcement; production verification must make one authenticated shared prompt and confirm a non-empty answer plus a one-message quota decrement.

**Yandex CLI browser authentication gotcha:** On macOS, `yc init --no-browser` can wait for the OAuth callback without printing a usable authorization URL. Use `yc init --username=<account-email>` with the normal browser flow for deployment sessions. Do not enable `--debug` around authentication because its output can expose sensitive authentication details.

**Yandex Object Storage recursive-copy gotcha:** Yandex CLI 1.18.0 marks `yc storage s3` as preview. During the 15 July 2026 AI Assistant release, both `yc storage s3 cp <dir> s3://rekindle/ --recursive` commands returned exit code 0 but silently omitted the same alphabetical tail of the 113-object release (42 root HTML objects and aliases). Never accept a recursive-copy exit code as proof of a complete frontend deployment. Read the bucket back and compare every manifest object byte-for-byte; upload any missing objects individually with `yc storage s3api put-object`. Set extensionless page aliases to `Content-Type: text/html` explicitly and verify their public HTTP headers.

**Service worker belongs in every static release:** `sw.js` was accidentally absent from `yandex/FRONTEND-RELEASE-MANIFEST.txt` during the 15 July 2026 social-removal rollout. The other 117 objects deployed correctly, but production kept `rekindle-cache-v21`, so existing browsers could continue serving the retired KindleChat catalog from cache. Keep `sw.js` in the manifest, increment `CACHE_NAME` whenever retiring cached pages, upload it with `Cache-Control: no-cache, max-age=0`, and verify both the direct bucket object and public website serve the new cache version.

**Worker-free frontend rule:** Production frontend code must not contain hard-coded `*.workers.dev` endpoints. Route Oracle, OCR, Reader, Reddit, Readwise, Pinterest, Substack, Akinator, Chords, Story, TMDB, Suggestions reports, and billing through versioned paths on the Yandex API Gateway and keep the gateway base URL in one shared client module.

**Telegram is a server-side MTProto client:** `telegram.html` talks only to the
authenticated `/api/rekindle/telegram/{action}` routes. The Yandex backend uses
`teleproto` and a Telegram application `api_id`/`api_hash`; it is not a Bot API
client and does not depend on Beeper or a home computer. Phone-code login,
Telegram login-email verification, and 2FA are implemented as short-lived
authorization stages. Login codes and 2FA passwords must never be logged or
stored. New Telegram accounts must still be created in an official Telegram
app.

Authorized MTProto `StringSession` values live only in the server-maintained
top-level Firestore `telegram_sessions/{firebaseUid}` documents, which have an
explicit client deny rule in `firestore.rules`. Both completed and pending
sessions are encrypted with AES-256-GCM, authenticated with UID-specific AAD,
using the 32-byte base64 `TELEGRAM_SESSION_ENCRYPTION_KEY`. Production also
requires secret-backed `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`. Chat references
returned to the browser are HMAC-signed so clients cannot substitute arbitrary
peer IDs or access hashes. Every route verifies the primary Firebase ID token
and has a server-side rate limit.

Users may optionally route their server-to-Telegram connection through an
MTProxy. The proxy host, resolved public IP, port, and normalized secret are
stored only inside the encrypted session payload; the browser receives only the
host/port summary and must re-enter the secret to change it. Resolve hostnames
before connecting and reject every loopback, link-local, private, carrier-grade
NAT, multicast, and reserved address to prevent the MTProxy setting becoming an
SSRF path into Yandex infrastructure. The stored resolved public IP prevents DNS
rebinding on later requests. Keep `telegram.html?demo=1` for complete Kindle UI
QA without a real Telegram or Firebase account.

**Telegram API application provisioning can be an external blocker:** every
deployment must use an application `api_id` and `api_hash` created by the
repository owner at `my.telegram.org/apps`. The portal can accept login and then
answer every valid create request with only the generic JavaScript alert
`ERROR`, especially when its anti-abuse checks reject the account or current
network. Changing valid titles, short names, platforms, URLs, or descriptions
does not reliably clear that state. Do not substitute Telegram Desktop's shared
credentials or credentials copied from another project. Leave the frontend
unpublished until the owner can create the application from a normal mobile or
matching-country connection, then put both values directly into Lockbox rather
than source, browser storage, terminal history, or chat.

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
pathname silently drops parameters such as `?lang=ru`, OAuth state, or
`telegram.html?demo=1` before page scripts read them.

**Suggestions reports are primary-only:** `suggestions.html` stores content in the primary RTDB. Its reports use `/api/rekindle/reports/submit`, authenticate against `rekindle-fork`, verify the stored content owner and canonical `suggestions/...` path, and store server-maintained records under `suggestion_reports`.

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

## ✅ Best Practices
-   **Images:** Use **WebP** or **SVG**. They are fully supported and perform best.
-   **Modals:** Always stick to the `.modal-overlay` / `.modal-box` DOM structure found in `weather.html`.
-   **Custom Selects:** `js/custom-select.js` replaces native `<select>` elements with a System 7 styled widget. Because the native select is hidden, the custom widget must explicitly respect the native `disabled` state and per-option `disabled` attributes via the `disabled` CSS class and early-return guards in the `CustomSelect` class (see the `updateDisabledState()`, `toggle()`, `open()`, `select()`, and `renderOptions()` methods). Without this, a disabled select will still appear interactive.
-   **Dark mode chrome:** `theme.js` applies a global `invert(1) hue-rotate(180deg)` filter in dark mode. Because `color-scheme: dark` changes the default canvas text color to white, the filter would invert that text back to black-on-black, so `theme.js` now also sets explicit `color: #000` on the dark root so the filter produces white text. White buttons, close boxes, and borders on light System 7 UI can also become black-on-black and disappear; add the `no-invert` helper class (re-inverted by `theme.js`) to any control that must stay visible in dark mode, e.g. `<div class="controls no-invert">` or `<button class="sys-btn no-invert">`. Note that `.no-invert` restores the original light colors, so text inside a `.no-invert` element with a transparent background may end up black-on-black; add a dark-mode `color: #fff` rule for that text (see `pet.html` `.btn-label`). **Note:** Dark mode is currently temporarily disabled — `theme.js` forces `light` mode and `settings.html` greys out/disables the theme dropdown.

## 🌐 External API Proxies (Rate-limiting)

### Static Yandex hosting requires Gateway API routes

The production site at `https://rekindle.website.yandexcloud.net` is static hosting. A relative `/api/...` request falls through to the static-site error document. All APIs must use an absolute Yandex Gateway URL.

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
referrer. For example, `books.html` calls the public Google Books endpoint
without a key; a dedicated Books API key or server-side proxy is required if
higher quotas become necessary.

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

## Suggestions Reporting

`js/reports.js` is Suggestions-only. It accepts only `suggestion` and `suggestion_comment`, submits to `/api/rekindle/reports/submit`, and stores server-written records under primary RTDB `suggestion_reports`. Suggestion comments are removed on the first report; top-level suggestions require reports from two different users. Optional Discord notifications use `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID`.

### Guarding Optional Firebase / CDN Dependencies
If an app can function without Firebase (e.g., local-only games), wrap Firebase initialization and all `auth`/`db` usage in feature checks. A blocked or failed CDN script must not prevent the rest of the page script from running. Use `typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && typeof firebase.firestore === 'function'` before initializing, and guard every `db.collection(...)` / `auth.onAuthStateChanged(...)` call. See `nonograms.html` for the pattern used in this codebase.

## 🏉 NRL Scores (scores.html)

ESPN's JSON scoreboard API (`site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`) supports NFL/NBA/MLB/NHL/soccer/AFL but **does not expose NRL**. NRL is served by `/api/rekindle/content/nrl-scores`; parsing lives in `yandex/rekindle-backend/nrl.js` and `scores.html` calls it through `RekindleCloud.apiBase`.

*   The scraper is regex-based and relies on ESPN's current server-rendered HTML structure. If ESPN changes their markup, the parser will return empty events.
*   Only games where both teams are in the known NRL team list are returned (filters out State of Origin / Tests).
*   The response uses a two-minute warm-instance cache plus a two-minute client cache header.
*   In `scores.html`, NRL is added to `LEAGUES` with `source: "nrl-scores"`, and `fetchFromAPI()` routes it to the Yandex endpoint.

## 🎮 Single-Player Games Catalog

The dashboard (`index.html`) reads the app registry from `icons.js`. Games are grouped by the `cat` property:

| Category | Purpose |
| :--- | :--- |
| `games` | Single-player / solitaire games |
| `two_player` | Local pass-and-play multiplayer |
| `live_game` | Firebase real-time online multiplayer |

### Single-player vs multiplayer split

Several games exist as both a single-player file and a multiplayer file. The single-player version is the canonical game name (e.g. `chess.html`), and the local/online variants add a prefix (`2pchess.html`, `livechess.html`). Following this convention keeps the catalog consistent and avoids confusing users.

### Single-player games added

*   **Tic-Tac-Toe** — `tictactoe.html` (vs CPU with Easy/Hard). Based on `2ptictactoe.html`; uses a minimax AI on Hard and random on Easy.
*   **Connect 4** — `connect4.html` (vs CPU with Easy/Hard). Based on `2pconnect4.html`; supports the same 4-in-a-row and 5-in-a-row toggle. Hard mode uses minimax with alpha-beta pruning to depth 4 plus a heuristic window evaluation.
*   **Dots & Boxes** — `dotsandboxes.html` (vs CPU with Easy/Hard). Based on `2pdotsandboxes.html`. Easy is greedy-box. Hard completes boxes, avoids giving the opponent a 3-sided box, and prefers moves that set up future boxes.
*   **Battleship** — `battleship.html` (vs CPU). Based on `2pbattleships.html`. Player places ships manually or with Auto; CPU places ships randomly and fires using hunt/target mode after a hit.
*   **Uno** — `uno.html` (solo vs bots). A wrapper that launches `liveuno.html?single=1`. The live game detects the `single=1` parameter and automatically hosts a 4-player match with 3 bots, starting immediately. The `liveuno.html` menu also has a "Play Solo vs Bots" button for the same mode.

All new single-player files disable CSS animations/transitions (`* { transition: none !important; animation: none !important; }`) and reuse the same System 7 window/title-bar patterns as their 2-player counterparts.

### Game mode badges and folder grouping

Games that exist in multiple modes are grouped by name in the dashboard (`index.html` → `getGroupedApps()`). The folder modal uses mode badges instead of mode names as the icon labels:

| Mode | Property | Badge |
| :--- | :--- | :--- |
| Single-player | `single: true` in `icons.js` | `1P` (`one-p-label`) |
| Local 2-player | `cat: 'two_player'` | `2P` (`two-p-label`) |
| Live online | `live: true` | `LIVE` (`live-label`) |
| New app | `new: true` in `icons.js` | `NEW` (`new-label`) |

Single-player entries that have a multiplayer counterpart (e.g. `chess`, `checkers`, `pool`, `yahtzee`, `battleship`, `connect4`, `dotsandboxes`, `tictactoe`, `uno`) should set `single: true` so the folder items are labeled with the game name and the correct badge.

**Important:** Do **not** add `single: true` to games that are single-player-only and have no multiplayer variant in the project (e.g. `crossy`, `dino`). That flag is only for the folder-grouping badge system. For solid pixel-art icons, use `filled: true` instead.

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

## Reddit comment-tree navigation

`reddit.html` uses two RSS requests for a Reddit thread: the normal feed supplies
all displayed comments, while the same `.rss` URL with `depth=1` supplies only
top-level comments. The normal feed is the critical path and must be rendered
immediately; fetch `depth=1` in the background and add root markers/navigation
after it resolves. Never block the first thread render on this metadata request.
The background request must use the Reddit API client's silent mode so it does
not keep the global loading indicator visible or race with foreground status UI.
Match the Atom `<id>` values from the depth-one feed against the full feed before
setting `isTopLevel` or `data-root-comment="true"`. A normal RSS entry does not
expose its parent ID, so never treat every entry as top-level.

The Reddit API client's request ID must be allocated before its 1.5-second
throttle wait. This lets a later foreground navigation supersede a sleeping
background root request; allocating the ID after the wait can make the old
background request cancel the user's newer subreddit or thread request.

`reddit.html` depends on `js/reddit-comments.js` for JSON parsing and progressive
root enrichment. A production release must upload that helper before the page
and bump the query-string version in the page whenever the helper API changes.
Uploading only `reddit.html` leaves the helper at 404 or stale in browser caches;
the thread still renders, but root markers/navigation fail after the background
request. Smoke-test the helper URL as well as both `reddit` page object aliases.

Thread JSON remains a fallback and `js/reddit-comments.js` parses its reply tree
recursively. Keep `raw_json=1` on the JSON request so comment HTML does not arrive
with an unnecessary extra escaping layer. Unauthenticated Reddit JSON currently
returns `403` through the production proxy, while both RSS variants remain
available; do not make JSON the primary thread source without verifying the
deployed proxy first.

The page flattens the reply tree in document order and stores `depth` plus
`isTopLevel` on each parsed comment. Rendered top-level comments have
`data-root-comment="true"`; the bottom-right navigation button uses those markers
to jump directly between root threads without doing expensive tree traversal on
each Kindle render.

`#content-area` also drives infinite scrolling for the subreddit feed. When a
thread is open, every scroll path must guard on `ui.currentThread` and must not
call `loadMorePosts()`. Reset `afterToken` when opening a thread as a second line
of defense; otherwise reaching the bottom of comments can append unrelated feed
posts to the thread.

The thread toolbar's right-side `>` button advances through the posts already
loaded in the current feed. `ui.feedPosts` must be replaced by `renderPostList()`
and extended by `loadMorePosts()` in exactly the same order as the rendered
cards. `loadThread()` finds and stores `ui.currentPostIndex`; do not clear the
feed list while opening a thread. The button is hidden outside thread mode,
disabled while a thread is loading or at the final loaded post, and remains
available after a thread-load error so the user can skip forward. External
browser round trips persist only the feed permalinks in `reddit_return_state`,
which is enough to restore the same next-thread order without caching full post
bodies.

The `>` button must remain exactly the same visual size as the toolbar's `<`
back button. Both use `.nav-btn`; `.next-thread-btn` may control only its
visibility and right alignment, and must not override width, height, padding,
font size, or line height. Adding a separate 48px minimum made the forward
button visibly larger at the Kindle UI scale. Keep the back button's visible
text as the literal ASCII `<` and localize only its title; `data-i18n` replaces
the symbol with words such as `Назад`, which changes the intrinsic button width
and breaks the exact `<`/`>` size match.

Feed-position helpers live in `js/reddit-comments.js` alongside the comment
navigation helpers. When that API changes, bump its query version in
`reddit.html`, keep `js/reddit-comments.js` in
`yandex/FRONTEND-RELEASE-MANIFEST.txt`, and publish the helper before the page.

## Git Workflow

After successfully completing any task that changes code:

1. Review the changes and run the relevant tests.
2. Stage only the files that belong to the current task. Never include unrelated user changes.
3. Create a concise, descriptive commit directly on the `main` branch.
4. Run `git push origin main` automatically without asking for additional confirmation.
5. Do not create a separate branch or Pull Request unless the user explicitly requests one.
6. Do not push if tests fail, secrets are detected, GitHub authentication is unavailable, or the intended changes cannot be safely separated from unrelated work. Report the blocker instead.
7. If GitHub rejects a direct push because `main` is protected, create a `codex/<short-task-name>` branch and a Pull Request, then report the restriction.
