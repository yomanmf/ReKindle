# Feature reference

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

The shared folder modal must size to its icons instead of reserving a fixed
viewport-height box: keep `height: auto`, a bounded `max-height`, and
`#folder-options { flex: 0 1 auto; min-height: 0; overflow-y: auto; }`. This
avoids the large empty lower region that Chromium 75 on Kindle Scribe Colorsoft
can paint with a jagged edge. Long game folders still scroll inside the bounded
grid. Keep only the 48x48 top close button; a bottom action unnecessarily makes
the content-sized modal taller.

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

**Reddit image-link gotcha:** `processCommentHtml()` puts linked post and
comment images inside their original anchor, while `addLinkHandlers()` routes
content links to the in-app browser. Keep the handler's early `closest('img')`
return after it prevents the native event: tapping any rendered image must not
navigate, but a text link in the same content remains usable.

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

The bottom-right controls are one vertical column: half-screen up, half-screen
down, then next top-level comment. The first two are shared by the subreddit
feed and thread; keep their container visible when comment navigation resets,
and hide only `#next-root-comment-btn` outside a thread with root comments. Keep
the next-comment button last and calculate page movement from
`#content-area.clientHeight`, not the viewport, because the toolbar and status
bar reduce the actual scrollable height.

`#content-area` also drives infinite scrolling for the subreddit feed. When a
thread is open, every infinite-loading scroll path must guard on
`ui.currentThread` and must not call `loadMorePosts()`. Reset `afterToken` when
opening a thread as a second line of defense; otherwise reaching the bottom of
comments can append unrelated feed posts to the thread.

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
visibility and disabled state, and must not override width, height, padding,
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
`/api/rekindle/kindle-digest/{action}`. The backend publishes `jobId + dispatchId`
to the Digest FIFO queue; the existing outbound-only article VM claims it through
`/api/rekindle/kindle-digest-worker/claim` with a Lockbox secret and
reuses its durable JSON queue and checkpoints. `kindle_digest_jobs` and
`kindle_digest_config` are server-only Firestore collections. Keep
`KINDLE_DIGEST_ALLOWED_UIDS` restricted because the worker currently has one
global Kindle delivery destination. Source options come from the worker's
`DAILY_SOURCES`; never hard-code a second source list in the frontend.
The legacy worker `/pull` action is rollback-only and must not be restored as
the production loop.

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

**Torrent control path:** `torrents.html` reuses the authenticated
`/api/rekindle/manga-kindle/{action}` service path with `torrents` and
`torrent-delete`, `torrent-pause`, and `torrent-resume`. The Yandex backend keeps the same Firebase UID allowlist and
server-held control token. The orchestrator reaches qBittorrent only at its
private Docker hostname, returns no filesystem paths, validates a 40- or
64-character hexadecimal info hash, and always uses `deleteFiles=true` so the
task and payload are removed together. Keep the qBittorrent Web UI bound to
localhost; never expose its port or credentials to the browser. The UI must use
its custom destructive confirmation modal because Kindle does not support
`confirm()`.

The production qBittorrent version is 5.2.3. Pause and resume use its
`/api/v2/torrents/stop` and `/api/v2/torrents/start` endpoints with one validated
info hash. Its paused states begin with `stopped` (older versions use `paused`);
only qBittorrent cards get a pause/resume button. Refresh the list after a
successful action so the label follows the server state.

The orchestrator's torrent list requests qBittorrent with `filter=all` and also
adds available completed requests from Seerr. Keep the dashboard's completed
view as a client-side filter on `progress >= 1` so paused and seeding uploads
remain visible and are labelled as completed. Seerr entries use `media-delete`:
the orchestrator verifies the request/media ID pair, asks Seerr to delete the
movie or complete series with its files through Radarr/Sonarr, then removes the
request record. Never expose the Seerr API key or internal service IDs beyond
the authenticated allowlisted control path.

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

**Daily Kindle E2E:** The existing `some-service` VM runs
`yandex/kindle-e2e/kindle-e2e.py` every day at `06:00 Europe/Moscow`. It SSHes
to the Manga and Books production VMs and runs Digest locally, all in parallel:
Manga builds one live chapter artifact, Books performs live
catalog/download/conversion/cover/email assembly, and Digest builds one live
article digest and performs delivery-size preparation. These commands must
never call the Kindle uploader, SMTP, or Amazon; only the final delivery
transport is replaced. The monitor reads the already configured VMWatch bot
token and subscriber database, then sends one combined report through
`@my_alerts_kindle_bot`. Do not create another VM, bot, source list, or delivery
credential for this check. The production commands are `node src/e2e.mjs`,
`flibusta-kindle-e2e`, and `node dist/src/e2e.js` respectively.
Open the VMWatch SQLite database with `mode=ro&immutable=1`: its WAL journal
otherwise tries to create lock files and fails inside the read-only systemd
sandbox.
Print the combined report before sending it. Direct routes from Yandex Cloud to
Telegram time out, so send the report with `curl` through the existing WARP
SOCKS proxy at `10.200.0.2:40000` and keep curl's bounded retries. The systemd
unit must require `warpns-warp-ready.service`.
