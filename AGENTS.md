# Rekindle agent instructions

## Quick commands

- Setup: `npm ci`
- Test: `node --test tests/*.test.js`; when backend code changes, also run `npm test --prefix yandex/rekindle-backend` or `npm test --prefix yandex/reddit-function` as applicable.
- Build: `npm run build`
- Lint: there is no configured linter; run `git diff --check`.
- Deploy: push the verified commit to `origin/main` and monitor `.github/workflows/deploy.yml`. Follow the production rules below for changes outside that workflow.
- Health: `ops http https://rekindle.website.yandexcloud.net/` and inspect the latest workflow with `gh run list --workflow deploy.yml --limit 1`.
- Never install `yc` or other Yandex software. If a required production step cannot use the documented CI workflow or standard HTTP API, stop and report the blocker.

## Yandex software prohibition

- Never install `yc`, Yandex Cloud CLI, Yandex SDKs, Yandex desktop applications, or Yandex-provided GitHub Actions under any circumstances.
- Access existing Yandex-hosted services only through standard HTTP APIs with ordinary tools such as `curl`. If that is insufficient, stop and report the blocker instead of installing Yandex software.

**Test command gotcha:** `package.json` has no `test` script, so `npm test`
fails. Run the complete root contract suite with
`node --test tests/*.test.js`, or use the narrower named `npm run test:*`
scripts when only one documented area changed.

**CRITICAL:** When developing for this project, you must adhere to the following constraints to ensure compatibility with Kindle and E-ink browsers.

## Documentation

Keep this file limited to rules that apply across the repository. Record durable, area-specific findings in the relevant guide below or beside the code; do not add duplicate examples or one-off debugging notes here. Update documentation when a discovery changes how future work should be done.

## Reference guides

Read the relevant guide before changing that area:

- [UI and Kindle browser](docs/agent-ui.md): HTML, CSS, browser compatibility, shared scripts, localization, icons, and visual checks.
- [Backend and platform](docs/agent-platform.md): Firebase, Yandex APIs and functions, auth, data, deployment, and backend gotchas.
- [Features](docs/agent-features.md): games, retired applications, and Reddit navigation.

For work spanning areas, read each applicable guide. Search within a guide for the feature or file you are changing; the guides retain detailed constraints and examples.

## Core compatibility and safety

- Kindle's target browser is Chromium 75 with an ES2019 ceiling: no optional chaining or nullish coalescing, no flexbox `gap`, no native alert/confirm/prompt, no web fonts or emoji, and no animations or transitions on E-ink. See the UI guide for approved alternatives.
- Two Firebase projects have different rules and responsibilities. Identify the target before changing data access; see the platform guide.
- Browser APIs go through authenticated, rate-limited Yandex Gateway routes. Do not restore retired Cloudflare endpoints or treat CORS as authorization; see the platform guide.

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
