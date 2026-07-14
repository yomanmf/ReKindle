# ReKindle paywall removal audit

Status: the non-social paywall removal is implemented, deployed to Yandex and
verified against the release archive. ReKindle+ is optional supporter status
and must not grant application capabilities.

| Area | Former gated capability | Current behavior | Protection that remains |
| --- | --- | --- | --- |
| `index.html`, `index_old.html`, `icons.js` | Launching apps marked `plus` | All catalog apps launch normally; no `app.plus` interception or badge | Normal app authentication where needed |
| `chat.html` | AI Assistant | Available to any signed-in user through `/ai/chat` | Firebase ID token, per-user limits, prompt bounds, provider endpoint allowlist |
| `quicknotes.html`, `quicktodo.html` | Handwriting OCR | Available to any signed-in user through `/ai/ocr` | Firebase ID token, rate limit, JPEG/PNG validation, payload bounds |
| `files.html`, `docs.html`, `photoframe.html` | Cloud files and photos | Available to every signed-in user through Yandex Object Storage | UID-owned paths, MIME validation, 100 MB/user, 25 MB/object, five-minute signed URLs |
| `mail.html` | IMAP/SMTP client | Available to any signed-in user | Firebase ID token, rate limits, host/port validation, private-network rejection, timeouts |
| `rssreader.html` | More than two feeds and feed categories | Unlimited feed documents and categories for the owner | Firestore owner-only rules |
| `mindmap.html` | Export | Export is available without supporter status | Local browser limits only |
| `dropbox.html` | Dropbox connection and saved settings | Available without supporter status | Dropbox credentials and owner-only Firestore settings |
| `airtype.html` | AirType cloud/pairing features | Available without supporter status | Authentication/session validation used by the app |
| `bluesky.html`, `mastodon.html`, `pinterest.html`, `substack.html` | Third-party integrations | Available without supporter status | The user's provider credentials; Pinterest/Substack server calls use authenticated Yandex routes |
| `readwise.html`, `readlater.html`, `newspaper.html`, `browser.html` | Reader and read-later server features | Available through Yandex Reader/Readwise routes | Firebase ID token, URL validation, SSRF protection, response bounds |
| `reddit.html` | Reddit feed and media proxy formerly implemented as a Pages Function | Available through the dedicated Yandex `rekindle-reddit` Function and shared Gateway origin | Reddit/Imgur allowlist, redirect revalidation, 5 MB response cap, bounded cache and stale fallback |
| `watchlist.html`, `chords.html`, `akinator.html` | Server-backed content/game features | Available through Yandex Gateway | Authentication, rate limits and upstream-specific validation |
| `pay.html`, `settings.html` | Subscription messaging | Described as optional project support | Stripe signature verification; status affects badges/history only |
| `privacy.html`, `locales/privacy-*.json` | Obsolete Pro-only and Cloudflare Worker disclosures | Privacy text now describes Yandex Gateway/Functions/Object Storage and authenticated-user quotas in every locale | Source locale JSON is authoritative; no DOM-time architecture rewrite |

## Removed mechanisms

- `pro-gate.js`
- `js/anti-tamper.js`
- the unused `pro` claim in Firebase social custom tokens
- dashboard `app.plus` launch interception
- the RSS two-feed limit and Pro-only category branch
- callable `createRssFeed` entitlement enforcement
- direct Firebase Storage access
- primary RTDB `pro_gate`
- every Cloudflare Worker/Pages handler and Wrangler manifest
- every frontend `workers.dev` and relative `/api/*` backend dependency

Supporter records (`isPro`, `proExpiresAt`, Stripe customer/subscription metadata)
remain only for optional badges, account history and moderation tooling. They
must not appear in an authorization condition for launching an app, storage,
AI, OCR, mail, export, feeds or categories.

## Functionality without a paywall

The non-social applications no longer require ReKindle+ in production. The
Yandex Functions, Gateway, primary Firebase rules and 113 frontend objects in
`DEPLOYMENT-CHECKLIST.md` are deployed. The `rekindle-socials` project and apps
that depend on it are explicitly outside the current production rollout.
The following are operational requirements, not subscription gates:

- a Firebase account for cost-bearing server routes;
- user-owned credentials for Dropbox, Mastodon, Bluesky, Pinterest, Substack,
  Readwise and mail providers;
- configured Yandex/third-party API secrets;
- storage quotas and abuse-prevention rate limits;
- upstream availability (Akinator and scraped NRL/Chord sources can change or
  block cloud egress independently of ReKindle).

## Evidence

- Yandex backend unit tests cover CORS, authentication gates, proxy target
  validation, private-target rejection, binary proxy responses and NRL parsing.
- Dedicated Reddit Function tests cover its hostname allowlist, redirect
  revalidation and oversized-response rejection.
- Main locale bundles contain no ReKindle application-paywall keys or text;
  only `news.error.paywall` remains for external publisher restrictions, while
  `pay.desc` and `support.desc` explicitly state that every app is available
  without a subscription.
- The non-social frontend release archive contains 68 changed source files and
  45 byte-identical extensionless HTML aliases (113 production objects). The
  five changed `rekindle-socials` pages are explicitly excluded. Checksums for
  the five non-social release archives are recorded in `RELEASE-SHA256.txt`.
- Public Object Storage verification matched all 113 release objects byte for
  byte; no object was missing or different. The two obsolete gate scripts now
  return HTTP 404.
- Production HTTP checks returned 200 for the dashboard, extensionless app
  pages, health and NRL. Protected Suggestions, AI, OCR, mail, storage, Reader
  and Akinator routes reached Yandex and rejected unauthenticated requests with
  HTTP 401 as designed.
- All changed inline scripts are parsed with `new Function` under the repository
  audit command.
- Gateway and Story YAML parse successfully.
- RTDB rule files parse as JSON.
- Repository searches find no active paywall hooks, `workers.dev` endpoints,
  relative `/api/proxy` routes, `pro_gate`, Worker source, or Wrangler manifest.
- Every privacy locale parses as JSON and contains no Cloudflare Worker,
  Worker AI, Reader worker or Pro-only storage disclosure.

Authenticated end-to-end checks still require a test Firebase account and any
provider credentials used by that app. Pinterest server OAuth, the shared TMDB
proxy and optional Stripe supporter billing additionally require their external
secrets in the Yandex Function. These are integration configuration limits, not
ReKindle+ gates; Watchlist retains its user-supplied TMDB-key mode, and Stripe
does not control access to any app.
