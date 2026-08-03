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

## Mandatory Yandex Production Delivery Rule

**A task that changes production-facing frontend files, Yandex Functions, API
Gateway routes, Firebase security rules, or release/delete manifests is not
finished until the verified change is deployed to the active production
services. Do this automatically after the GitHub delivery without waiting for a
separate reminder.** Documentation-only and test-only changes do not require a
production deployment.

* Publish changed backend functions and API Gateway specifications before the
  frontend that depends on them.
* Build the frontend through `yandex/prepare-frontend-release.js`; never upload
  checked-in pages containing the Firebase API-key placeholder.
* Upload every release-manifest object and root HTML alias individually or
  verify each one after any bulk copy. Compare production objects byte-for-byte
  with the staged release because recursive Yandex CLI copies are unreliable.
* Apply `yandex/FRONTEND-DELETE-MANIFEST.txt` only after replacement objects are
  live, then verify every listed key is absent.
* Run production HTTP smoke tests for the changed pages and API routes. Confirm
  `sw.js` is served with the intended cache version and no-cache headers when a
  release retires cached pages.
* If authentication, IAM, a missing production credential, or an external
  provider prevents deployment, report the exact blocker. A GitHub push alone
  does not count as delivery for a production-facing task.

**macOS/zsh deployment-shell gotcha:** `path` is a special zsh array tied to
`PATH`. A loop such as `for path in ...` overwrites the executable search path
after its first iteration, so later `curl`, `jq`, and `yc` calls fail with
`command not found`. `status` is also a read-only zsh parameter, so assigning an
HTTP response code to it aborts the script with `read-only variable: status`.
Use neutral names such as `route`, `object_key`, or `http_status`.

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

**Custom-select value gotcha:** `js/custom-select.js` refreshes its visible
trigger when the hidden native `<select>` emits `change`. Assigning
`select.value` programmatically does not emit that event, and a
`MutationObserver` cannot observe a form control's live `value` property. This
can make a saved setting look as though it reverted even though `localStorage`
contains the correct value. In `settings.html`, load programmatic values through
`updateSettingsSelectValue(selectId, value)`, which suppresses the inline save
handler while notifying the custom control. Apply the same pattern on other
pages that restore custom-select values after `DOMContentLoaded`.

### 6a. Cross-page dark theme

All root HTML pages load `theme.js`, so dark mode must stay centralized there
instead of growing page-specific color overrides. The shared implementation
inverts the rendered document at the root; `img`, `video`, `canvas`, `iframe`,
`object`, and `embed` receive the same filter a second time so their original
colors are preserved. Add `.no-invert` only to a non-media subtree that must
also keep its original palette.

Do not set dark-valued CSS variables such as `--bg-color: #000` while the root
filter is active: the root inversion would turn them back to white. New pages
must load the current cache-busted `theme.js` URL, and any theme release must
also update the copy in `sw.js` and increment `CACHE_NAME`; otherwise the
service worker can keep the light-only script alive across navigation. When a
theme version bump changes every root page, include all root HTML files in
`yandex/FRONTEND-RELEASE-MANIFEST.txt`; publishing only `theme.js` and a subset
of pages leaves the omitted screens requesting the previous cached query URL.

Do not expose a `system` theme option: Chromium 75 predates
`prefers-color-scheme`, and Kindle Scribe Colorsoft does not provide another web
API for its device appearance. Keep theme choices to light, dark, and timed auto.

The global bottom-left theme gesture also lives in `theme.js`: two taps within
600 ms inside the viewport's bottom-left 64x64 pixels switch the effective
theme and save an explicit `light` or `dark` preference. Kindle's double-tap
zoom guard suppresses the second synthetic `click`, so touch screens must count
the gesture from the capture-phase `touchend` event and ignore its following
synthetic click; `click` remains only as the mouse fallback. Do not add
page-level gesture handlers. The shared script writes the same Firestore
setting and parent sync timestamp as `settings.html`, retaining
`rekindle_theme_pending_sync` until a
Firebase-capable page can save it. Dashboard and Settings cloud reads must not
overwrite the local theme while that marker exists. Cache-bust and release the
shared script plus every root HTML page.

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

### 8. External application links

Catalog entries in `icons.js` may define a full `url` when their dashboard icon
must open an external web application. Both `index.html` and `index_old.html`
must prefer `app.url` and otherwise fall back to the app's local `.html` path in
the regular grid and the featured section. Keep navigation in the current tab
for Kindle compatibility;
do not depend on `target="_blank"` or popup APIs. When changing a catalog URL,
bump the `icons.js` query version in both dashboards and the matching entry in
`sw.js` so an older service-worker response cannot preserve the previous link.

### 9. Dashboard Misc folder

Catalog entries assigned `cat: 'misc'` in `icons.js` and the virtual Games
folder are rendered inside the virtual Misc folder by both `index.html` and
`index_old.html`. The two-player Games folder remains the Games folder's final
child. AI Assistant stays in Misc; Kindle Digest and Reddit stay at the root.
Keep both dashboard implementations synchronized when changing this grouping.
Keep the folder's in-code fallback label as `Разное`; dynamic tiles can briefly
use that fallback before Russian translations load.

`icons-beta.js` is merged into `APPS` at runtime. Keep application IDs unique
across both registries: duplicating an ID can render one copy inside Misc and a
second copy at the dashboard root. Move a beta app by changing its existing
`icons-beta.js` category, and publish/cache-bust that file with the dashboards.

### 10. Dashboard customization is retired

`index.html` and `index_old.html` intentionally have no edit mode, favorites,
hidden apps, featured-section toggle, or reset-preferences UI. Do not restore
the old `rekindle_favorites` / `rekindle_featured_hidden` state or Firestore
sync. The Lite/Legacy ES6-warning injection in `build-automation.js` is anchored
to the app icon class assignment, not to removed favorite-state code.

The dashboard About modal is also retired. The ReKindle logo in `index.html`
is intentionally static, and the old dashboard no longer has its former info
button. Do not restore `openAbout`, `about-modal`, or their locale keys.

The dashboards have no guest-mode label or control. Signed-out users stay
behind the mandatory login wall, and `#sys-account-menu` remains hidden: do not
restore a redundant Log In / Register control outside the modal. After sign-in,
the username occupies the former Log Out `#auth-btn` slot; tapping it toggles
`#account-menu-dropdown`, whose Log Out action opens the existing confirmation
modal.

**Dashboard top-spacing gotcha:** `index.html` keeps `.desktop-wrapper` aligned
to the top of the body's content box instead of vertically centering it. The
body's top padding tracks the scaled 35px system menu bar via
`calc(35px * var(--rekindle-scale, 1))`, leaving only the tab container's small
padding between the system menu bar and the Home tab. The centered top clock is
intentionally retired; do not restore `top-clock` or its synchronization request. Do not restore
`body { align-items: center; }`, which creates a large device-height-dependent
gap above the dashboard. Keep `.desktop-wrapper` at `height: calc(100% - 6px)`;
the 6px reserve leaves a narrow scaled gap for the dashboard's hard shadow
instead of the large empty strip caused by percentage heights such as `90%`.

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

**Dynamic i18n race:** Mark dynamically inserted fallback text with the matching
`data-i18n` attribute even when it is initially produced through `window.t()`.
The markup can be created before the locale JSON resolves; without the
attribute, the English fallback remains after the rest of the page is translated.

**Reddit loading-indicator gotcha:** `reddit.html` uses the toolbar indicator for
feed requests, but thread requests already render their own loading state in
`#content-area`. Pass `showLoading: false` for thread RSS/JSON requests; do not
use `silent`, because it also suppresses rate-limit handling.

**Reddit publication-time gotcha:** Feed and thread timestamps use different
source fields: RSS uses `pubDate` or namespaced `date`, Atom uses `published` or
`updated`, and JSON uses `created_utc` in seconds. Normalize all of them to
`publishedAt`, add Moscow's fixed UTC+3 offset, and format with UTC getters;
Kindle's local timezone is unreliable. Keep the Moscow timestamp, without a
timezone suffix, in a separate
right-aligned `.post-date` grid cell in both feed cards and opened threads.

**Reddit upvote-count gotcha:** RSS and Atom responses do not expose a reliable
post score. Prefer the existing JSON feed/thread endpoints and normalize their
numeric `ups` field to `upvotes`; keep RSS only as the fallback when JSON is
unavailable. Render the counter and publication date together through
`renderPostFacts()` so the arrow/count stays immediately left of the date.

**Reddit feed-select gotcha:** The sorting and period controls use the shared
`css/custom-select.css` and `js/custom-select.js` so Kindle gets 52px touch
targets instead of the browser's small native option popup. When restoring a
saved value, dispatch `change` with the inline handler temporarily detached so
the custom trigger refreshes without starting another feed request. Do not wrap
these selects in `<label>`: label activation redispatches the click to the
hidden native select and immediately closes the custom menu. Use
`aria-labelledby` instead.

**Reddit dark-sidebar gotcha:** Keep `#saved-list` on a pure white background.
If it inherits the sidebar's `#fafafa`, root dark-theme inversion produces
near-black `#050505`; Colorsoft dithers that empty area into visible bands and
uneven shades below the saved subreddits.

Load `theme.js` before Reddit's blocking external Firebase SDK scripts. If the
theme script comes afterward, a slow CDN response leaves the initial white
background visible before the saved dark theme can be applied.

**Reddit Firestore transport gotcha:** Initialize its Firestore instance with
`experimentalForceLongPolling: true` before the first read or write. Colorsoft
can leave WebChannel write acknowledgements buffered indefinitely: the sidebar
then stays on `Saving...`, and a refresh restores the old cloud list. Forced
long-polling closes each response after data arrives and makes saved-subreddit
writes, including deletions, receive their acknowledgement.

**Reddit thread-navigation spacing:** Keep a fixed left margin on
`.next-thread-btn` instead of `margin-left: auto`. The subreddit input is the
toolbar's flexible item, so the fixed margin shrinks that field and preserves a
safe gap between the saved-subreddit star and the next-post `>` button.

**Reddit last-view gotcha:** `reddit_return_state` is persistent app state, not
just a short-lived return marker for external links. `reddit.html` saves it on
`pagehide` and restores the subreddit or open post (including scroll position)
on the next visit. Do not delete it during restore or add an expiry.

The feed and an opened thread share `#content-area`, so their scroll positions
must remain separate. Capture `ui.feedScrollTop` only when entering a thread
from the feed, persist it alongside the current-view `scrollTop`, and restore it
both immediately and after `loadCurrentSub()` finishes when the user goes back.
Otherwise the thread's scroll offset leaks into the newly rendered feed.

**Translated-control identity gotcha:** Never derive application state from a
translated label (for example, comparing a tab's `innerText` with `"agenda"`).
Russian translation changes the label and breaks the comparison. Keep a stable
`data-*` value such as `data-view="agenda"` and compare that instead.

### Icons (SVG)
Icons are stored as raw SVG strings in `icons.js`.
*   **Size:** Designed for **32x32** pixel grid.
*   **Stroke:** `stroke-width="2"` (Standard) or `"1.5"` for detail.
*   **Style:** `fill="none"` `stroke="black"` OR `fill="black"` `stroke="none"`.

Dashboard icon changes must bump the matching `icons.js` or `icons-beta.js`
query version in both `index.html` and `index_old.html`. Update the matching URL
in `sw.js` and increment `CACHE_NAME` as well so Kindle does not keep rendering
the previous SVG from the service-worker cache.

## JavaScript Global `t` Naming Conflict

Weather location names are saved as external geocoder values and are not
translated automatically. Add aliases such as `weather.city.moscow` to locale
bundles and let `weather.html` fall back to the saved name when an alias is
absent; do not rewrite or discard saved locations just to localize their label.

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
`books_kindle_*` Firestore collections by `books-kindle-service.js`; the
Flibusta worker polls `/api/rekindle/books-kindle-worker/*`, reuses its existing
catalog/conversion/cover/SMTP pipeline, and reports status back. Keep raw source
URLs and Kindle addresses out of public job responses, keep all three
collections denied in `firestore.rules`, and reuse the existing worker secret
only through the backend's timing-safe bearer check.

**Books worker deploy verification:** The production bot routes Telegram through
`RUNTIME_TELEGRAM_PROXY_URL`. Its VM deploy-agent must pass that proxy to the
Telegram `getMe` health check too. A direct check times out after the stability
delay, rolls back a healthy worker image with generic `COMMAND_FAILED`, and
leaves web jobs indefinitely at `Waiting for the books worker.`

**Books worker runtime secret:** The production VM reads
`BOOKS_KINDLE_WORKER_SECRET` from the dedicated deletion-protected
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
from the generic Open-Meteo API. The button-paged 30-day forecast uses the
compact EC46 ensemble mean from the Seasonal API because the generic endpoint
stops at 16 days; if that request fails, the existing seven daily values remain
as a fallback. Keep the modern and classic home-widget implementations
synchronized. Use Open-Meteo's modern
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

## ✅ Best Practices
-   **Images:** Use **WebP** or **SVG**. They are fully supported and perform best.
-   **Modals:** Always stick to the `.modal-overlay` / `.modal-box` DOM structure found in `weather.html`.
-   **Custom Selects:** `js/custom-select.js` replaces native `<select>` elements with a System 7 styled widget. Because the native select is hidden, the custom widget must explicitly respect the native `disabled` state and per-option `disabled` attributes via the `disabled` CSS class and early-return guards in the `CustomSelect` class (see the `updateDisabledState()`, `toggle()`, `open()`, `select()`, and `renderOptions()` methods). Without this, a disabled select will still appear interactive.
-   **Dark mode chrome:** `theme.js` applies a global `invert(1) hue-rotate(180deg)` filter in dark mode. Because `color-scheme: dark` changes the default canvas text color to white, the filter would invert that text back to black-on-black, so `theme.js` now also sets explicit `color: #000` on the dark root so the filter produces white text. White buttons, close boxes, and borders on light System 7 UI can also become black-on-black and disappear; add the `no-invert` helper class (re-inverted by `theme.js`) to any control that must stay visible in dark mode, e.g. `<div class="controls no-invert">` or `<button class="sys-btn no-invert">`. Note that `.no-invert` restores the original light colors, so text inside a `.no-invert` element with a transparent background may end up black-on-black; add a dark-mode `color: #fff` rule for that text (see `pet.html` `.btn-label`). **Note:** Dark mode is currently temporarily disabled — `theme.js` forces `light` mode and `settings.html` greys out/disables the theme dropdown.

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

## 🎮 Single-Player Games Catalog

The dashboard (`index.html`) reads the app registry from `icons.js`. Games are grouped by the `cat` property:

| Category | Purpose |
| :--- | :--- |
| `games` | Single-player / solitaire games |
| `two_player` | Local pass-and-play multiplayer |
| `live_game` | Firebase real-time online multiplayer |

**Dashboard game folders:** The home screen renders the virtual `folder_games`
tile inside `folder_misc`. Its direct games use the `games` category, and its
final child is the virtual `folder_two_player` containing both `two_player` and
`live_game`. Do not render favorite or featured games separately on the home
screen. Build both folder contents from the full game registry so a favorite
game is not accidentally omitted. The former Games and Multiplayer category
tabs no longer exist.

Virtual folders are not application records and must use `virtualFolder: true`
so they cannot be favorited or hidden. Grouped game-mode folders must also carry
the primary app i18n key; otherwise `app.folder_*.name` is missing. When the
Games folder is opened during dashboard edit mode, keep customization controls
on the real child games so previously hidden games can be restored.

The shared folder modal was originally sized for two or three game variants.
The game folders contain many entries, so letting the
entire `.modal-box` scroll creates a narrow 2-column, 2,000+ px document and
pushes its close action off screen. Keep `#folder-modal .modal-box` as a bounded
wide flex column with `overflow: hidden`; only `#folder-options` may scroll
(`flex: 1 1 auto; min-height: 0; overflow-y: auto`). Both the 48x48 top close
button and the bottom close action must remain outside that scrolling grid.
The Games folder layout and both close actions were verified at the Kindle
Scribe Colorsoft panel dimensions in portrait (`1980x2640`) and landscape
(`2640x1980`), as well as the conservative `600x800` CSS viewport used by the
older Kindle-browser regression check.

**Dashboard home layout:** Keep only the Home tab in the top folder strip. The
four-square Dashboard tab and the Essentials, Tools, Lifestyle, Games, and
Multiplayer category tabs are retired. The application heading is also absent;
the Edit button remains in a right-aligned toolbar. Weather and calendar are
part of the normal home scroll after `#app-grid`, not a separate tab. Weather
must span the available width and include current conditions plus seven daily
forecast cells; the full-width month calendar follows underneath. Keep this
contract aligned in both `index.html` and `index_old.html`.

## Application retirement checklist

Deleting an app means removing its registry entry and source page plus every
reachable contract: dashboard-only modal/assets, settings controls, locale and
privacy keys, Firebase rules, Gateway paths, backend handlers/tests/dependencies,
release-manifest entries, and documentation. Add both the `.html` object and its
extensionless alias to `yandex/FRONTEND-DELETE-MANIFEST.txt`. Remove any service
worker precache entry and bump `CACHE_NAME` so installed browsers cannot keep
serving the retired page. Search the whole repository for the retired IDs and
provider names after the deletion; shared translation keys discovered in active
pages must be moved to a neutral namespace before the app-specific namespace is
removed.

Dashboard functions are defined inside an IIFE and exported near the end of
`index.html` and `index_old.html` for inline handlers. When retiring a modal or
action, remove its `window.someHandler = someHandler` export too. Exporting a
deleted identifier throws a `ReferenceError` during page load and prevents all
later exports in that block (including `window.closeModal`) from being assigned,
which can make unrelated modals impossible to close.

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

`loadCurrentSub()` uses the existing per-feed `localStorage` entry as a
stale-while-revalidate preview: parse and render non-empty cached posts before
awaiting Reddit, then replace them with the fresh response. If refresh fails,
leave the already rendered cache in place; only show the blocking error when
there was no usable cache. Keep the network request active so the API client's
request ID can supersede it when the user opens a thread or another feed. The
client must recheck that ID after `await res.text()` as well as after `fetch()`;
otherwise a response body that finishes late can overwrite the newer screen.

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
throttle wait. Foreground thread RSS and JSON fallback requests skip that wait;
feed and background metadata requests retain it. This lets user navigation start
immediately while a later foreground request can still supersede older work.
The Yandex function already retries Reddit upstream failures, so the browser
must not repeat 429/5xx responses and multiply the wait.

Start the normal thread RSS first and immediately start `depth=1` with
`background: true` so both requests share the same request generation and run
concurrently. Do not await the root request before rendering. Pass
`skipThrottle: true`; otherwise the feed throttle adds another 1.5 seconds. A
later foreground request increments the generation and supersedes both old
responses, while the `currentThread` guard prevents stale DOM updates. Normalize
the root promise immediately so a fast failure cannot become an unhandled
rejection while the main RSS is pending. Production checks on 1 August 2026
showed JSON still returning `403`; a 200-comment thread rendered its main RSS in
about 1.5 seconds while sequential root metadata needed another 8.1 seconds, so
keep the two reliable RSS requests concurrent until JSON is verified available.

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

Reddit also returns `403` for individual HTML permalinks from Yandex even when
their RSS feeds work. Media-only RSS entries include a preview image inside the
metadata table; extract that URL before removing the table and render it through
the dedicated Reddit proxy. Do not replace the preview with an "Open Post on
Reddit" link to the same permalink, because Browser's article extractor will
only repeat the blocked HTML request.

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

**Pretty-URL query preservation:** `theme.js` removes `.html` with
`history.replaceState()`. The replacement URL must always append
`window.location.search` and `window.location.hash`; using only the pathname
silently deletes startup parameters before page initialization. Prefer the
extensionless `browser?...` route for internal Browser handoffs, keep
`theme.js` in `yandex/FRONTEND-RELEASE-MANIFEST.txt`, and smoke-test that the
production Browser retains `lite`, `return`, and `url`. On 19 July 2026 the
production `theme.js` was stale because the shared asset was absent from the
release manifest, so Reddit opened an empty Browser tab even though its target
URL had been encoded correctly.

**Dashboard weather drilldown:** The 30-day cards in both `index.html` and
`index_old.html` are native links to `weather?date=YYYY-MM-DD`. Keep the two
dashboards synchronized. `weather.html` accepts the date only when it exactly
matches Open-Meteo's `daily.time`, using the generic 16-day response first and
the EC46 ensemble mean for later dates. It then shows that day's high/low,
apparent temperature range, and condition; hourly entries are available only
inside the generic forecast horizon. Invalid or expired dates fall back to
current conditions and current apparent temperature.
Weather hour labels use Open-Meteo wall-clock strings in 24-hour `HH:MM`
format. The detail page must keep its 48px previous/next buttons because Kindle
users cannot reliably reach all 24 cards with touch-only horizontal scrolling.

**Browser Reader Reddit fallback:** Yandex-hosted requests from the generic
Reader backend can receive HTTP 403 from `www.reddit.com` even when the same
public permalink works in a desktop browser. Before fetching an article,
`yandex/rekindle-backend/index.js` normalizes exact Reddit web hosts
(`reddit.com`, `www.reddit.com`, `new.reddit.com`, and `sh.reddit.com`) to
`old.reddit.com` and sends the browser-like headers used by the dedicated Reddit
proxy. Keep this host check exact so lookalike domains are not rewritten, and
continue to pass the normalized URL through `validatePublicHttpUrl()` and its
redirect revalidation. This fallback belongs in the Reader backend rather than
the frontend because Reddit links can enter Browser from several pages.

**Kindle Digest control path:** Authenticated browser requests go through
`/api/rekindle/kindle-digest/{action}`. The existing outbound-only article VM
polls `/api/rekindle/kindle-digest-worker/{action}` with a Lockbox secret and
reuses its durable JSON queue and checkpoints. `kindle_digest_jobs` and
`kindle_digest_config` are server-only Firestore collections. Keep
`KINDLE_DIGEST_ALLOWED_UIDS` restricted because the worker currently has one
global Kindle delivery destination. Source options come from the worker's
`DAILY_SOURCES`; never hard-code a second source list in the frontend.

**Kindle Digest status-history layout:** use the existing two-column CSS Grid
for each `.history-item`. Do not float `.history-state`: inline icon badges can
escape the row and make later statuses accumulate progressively farther left.
Keep status pictograms as monochrome inline SVG with `currentColor`, preserve
the one-column status layout below 520px, and keep every hit target at least
48px for Kindle Scribe Colorsoft and compact Kindle browsers.

**Article to Kindle is retired (July 2026):** Keep only digest collection in
the Kindle Digest queue. Do not restore `kindlearticles.html`, its dashboard
entry, locale bundle, client script, or the backend `mode: 'article'` branch.

**Manga to Kindle control path:** `mangakindle.html` uses authenticated
`/api/rekindle/manga-kindle/{action}` requests. The Yandex backend forwards only
the allowlisted actions to the orchestrator's protected `/control/{action}`
route with a server-held token. The orchestrator stores these as
`web:rekindle` jobs and suppresses bot notifications for them. Never synthesize
bot updates or call a messaging API from this page. Search results are selected
before job creation so the worker never needs an interactive chat callback.

**Manga to Kindle layout:** Match Books to Kindle with `data-no-scale`, a
`720px` maximum window width, and panels in normal document flow in every
orientation. Do not add a landscape grid: fitting three columns into the shared
window squeezes localized status values, while removing the maximum makes this
page visibly wider than Books to Kindle. Hide `#search-results` as soon as a
title is selected and restore it only when chapter loading fails.
Status cues are monochrome inline SVG from the trusted `STATUS_ICONS` map, not
Unicode emoji, because Kindle browsers render many emoji as missing glyphs.
Web jobs use the same server-side Amazon Send to Kindle uploader and saved
session as Telegram jobs, but must not call the Telegram API or expose Amazon
login actions in the Kindle browser. If the shared server session expires,
restore it operationally on the uploader instead of redirecting the user.

## Git Workflow

**Exchange Calendar transient-storage gotcha:** Production can intermittently
return a Firestore read error while loading `exchange_calendar_sessions`, even
though the saved Exchange connection is still valid. Keep the single retry in
`readSessionDocument()` in `yandex/rekindle-backend/exchange-calendar-service.js`;
both the dashboard agenda and Calendar app use that shared path. Do not turn a
single storage failure into a reconnect flow or delete the session document.

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
