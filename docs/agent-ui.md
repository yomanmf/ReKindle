# UI and Kindle browser reference

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
600 ms in the 64px-wide band immediately above the viewport's bottom-left 64px
edge switch the effective theme and save an explicit `light` or `dark`
preference. Keep the actual bottom-left 64x64 pixels free: Reddit's Saved
Subs sidebar places its Top button there. Kindle's double-tap
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
Root dashboard apps are sorted by the registry's English `name`, not by their
translated label. Choose that stable name deliberately when a tile must occupy
a specific position; for example, `Torrents` sorts immediately after `Reddit`
while the Russian locale still renders `Загрузки`.

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

**UI punctuation:** Short standalone descriptions, status messages, errors,
and modal text omit a sentence-ending period. Preserve ellipses (`...`),
abbreviations such as `Отпр.` and `мин.`, and normal punctuation in long-form
privacy prose. Update both the relevant `locales/*.json` value and any HTML or
JavaScript fallback text; English fallbacks may be visible before translations
load. Bump an edited standalone JavaScript file's query version in its HTML
page so returning Kindle browsers fetch the changed text.

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

**Reddit rate-limit countdown gotcha:** Foreground HTTP 429 responses start the
inline `#rate-limit-message` countdown and reload the page after 5 seconds.
Keep the timer based on an absolute deadline, cancel it after a successful or
manually retried foreground request, and never start it for background score
enrichment; an optional score failure must not reload otherwise usable content.
When the main thread RSS returns 429, skip the JSON fallback: it clears the
countdown and makes another request during the limit. Show the same countdown
inside the thread content area while the page waits to reload.
Reddit's red error views must map HTTP status to localized messages instead of
showing raw `Error.message`, which may be English browser or proxy text.

**Reddit publication-time gotcha:** Feed and thread timestamps use different
source fields: RSS uses `pubDate` or namespaced `date`, Atom uses `published` or
`updated`, and JSON uses `created_utc` in seconds. Normalize all of them to
`publishedAt`, add Moscow's fixed UTC+3 offset, and format with UTC getters;
Kindle's local timezone is unreliable. Keep the Moscow timestamp, without a
timezone suffix, in a separate
right-aligned `.post-date` grid cell in both feed cards and opened threads.

**Reddit upvote-count gotcha:** RSS and Atom responses do not expose a reliable
post score, while unauthenticated Reddit JSON returns `403` from the production
Yandex IP. Fetch score data from the official `embed.reddit.com` feed/post via
the proxy's `extract=scores` mode; the function must return only a compact
`{ t3_id: upvotes }` map instead of sending modern embed HTML to Kindle. Keep
RSS as the primary content source and JSON only as its fallback. Embed feeds
can omit pinned or recently shifted RSS entries, so enrich unmatched IDs from
their individual embed pages. Render the counter and publication date together
through `renderPostFacts()` so the count followed by its arrow stays immediately
left of the date. Score requests must stay in the current background request
generation and
must never block the first feed or thread render: emit an empty counter node,
show the RSS content immediately, then fill matching `data-post-id` nodes when
the compact score response arrives.

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
Keep `.sidebar-item.active` medium gray with black text so root inversion makes
the selected saved subreddit dark gray instead of a glaring white block.

**Reddit feed-preference sync gotcha:** A user can change the feed sort before
Firebase Auth finishes. Mark local changes with
`reddit_feed_preferences_pending_sync`, do not let a late cloud read overwrite
them during that page session, and clear the marker only after Firestore
acknowledges the full preferences map.

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
`.thread-refresh-btn` instead of `margin-left: auto`. The subreddit input is the
toolbar's flexible item, so the fixed margin shrinks that field and preserves a
safe gap between the saved-subreddit star and the thread refresh button. Normal
toolbar sibling spacing then separates refresh from the next-post `>` button.
The refresh button is visible only for an open thread, retries the saved
`currentThread` permalink, and stays disabled while that request is active.

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

## ✅ Best Practices
-   **Images:** Use **WebP** or **SVG**. They are fully supported and perform best.
-   **Modals:** Always stick to the `.modal-overlay` / `.modal-box` DOM structure found in `weather.html`.
-   **Custom Selects:** `js/custom-select.js` replaces native `<select>` elements with a System 7 styled widget. Because the native select is hidden, the custom widget must explicitly respect the native `disabled` state and per-option `disabled` attributes via the `disabled` CSS class and early-return guards in the `CustomSelect` class (see the `updateDisabledState()`, `toggle()`, `open()`, `select()`, and `renderOptions()` methods). Without this, a disabled select will still appear interactive.
-   **Dark mode chrome:** `theme.js` applies a global `invert(1) hue-rotate(180deg)` filter in dark mode. Because `color-scheme: dark` changes the default canvas text color to white, the filter would invert that text back to black-on-black, so `theme.js` now also sets explicit `color: #000` on the dark root so the filter produces white text. White buttons, close boxes, and borders on light System 7 UI can also become black-on-black and disappear; add the `no-invert` helper class (re-inverted by `theme.js`) to any control that must stay visible in dark mode, e.g. `<div class="controls no-invert">` or `<button class="sys-btn no-invert">`. Note that `.no-invert` restores the original light colors, so text inside a `.no-invert` element with a transparent background may end up black-on-black; add a dark-mode `color: #fff` rule for that text (see `pet.html` `.btn-label`). **Note:** Dark mode is currently temporarily disabled — `theme.js` forces `light` mode and `settings.html` greys out/disables the theme dropdown.
