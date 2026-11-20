# Versions, releases and app updates — design

Agreed with the owner on 2026-11-20.

## Why

- **Debugging.** When something looks wrong, the owner wants to see at a glance which version of the app a phone is running and which version of the server it talks to. A phone can keep running an old cached copy of the app after a deploy, so the two can differ.
- **Controlled releases.** Today anyone with Wrangler can deploy `main` by hand (`pnpm deploy:d1`). The owner wants production to change **only when a Release Please PR is merged**. That release is then deployed to Cloudflare automatically, with a version number and a changelog.
- **Getting the new version.** A PWA resumed from the background can stay on an old version for days. She should get new versions without having to know how.

## Goals

1. **Release Please** keeps a release PR open on `main`, with the next version and a changelog built from conventional commits.
   - There is **one version for magomap**, covering the web app and the API together, because they ship together as one Worker.
   - Merging that PR creates the release, tagged `magomap-v<version>`.
2. **Deploy on release only.** A GitHub Actions job runs after the release is created. In order, it:
   1. checks out the release commit;
   2. runs the same checks as CI (`scripts/checks.sh`);
   3. records a D1 Time Travel bookmark in the job summary;
   4. applies D1 migrations (`wrangler d1 migrations apply DB --env d1 --remote`);
   5. builds and deploys (`pnpm deploy:d1`).

   Any failing step stops it. Nothing is deployed on plain pushes to `main`.
3. **Both halves report their version.**
   - The app knows its own `version`, short `commit` (7 characters) and `builtAt` (ISO time), fixed at build.
   - The Worker knows the same three values, passed at deploy, and `GET /api/health` returns them.
4. **Account shows them** in an "About" section at the bottom:

   ```
   About
   App      0.2.0 · a1b2c3d · built 2026-11-20 14:02
   Server   0.2.0 · a1b2c3d · built 2026-11-20 14:02
   ```

   - When the commits differ, a line says "The app is older than the server. Update to get the latest." and offers the Update button, if an update is waiting.
   - Offline, the server line says "Server: offline". It never shows a stale value as current.
   - Values are selectable text, so they can be copied into a bug report.
5. **Updates:**
   - **On a cold start** (the app opened fresh, not resumed), if a new version is already waiting, it is applied before she starts working: a quiet reload within the first moments.
   - **While the app is open:**
     - It checks for a new version whenever it returns to the foreground (`visibilitychange` → visible), and at most once every 30 minutes while it stays visible.
     - When one is ready, a small banner says "새 버전이 준비됐어요 · 업데이트" / "A new version is ready · Update".
     - Tapping Update reloads into the new version. The banner can be dismissed for the session.
     - Account shows the same Update button.
   - It **never reloads on its own while she's using the app.**

## Non-goals

- Separate versions for the web app and the API.
- Deploying the Postgres environment from CI. It stays local-only.
- Rollback automation. The bookmark in the job summary plus a manual `wrangler rollback` or D1 restore is enough.
- The homepage's GitHub Pages workflow, which stays as it is.

## Anti-goals

- **A deploy that skips checks or migrations**, or deploys a commit other than the release's.
- **An update that loses her unsaved typing.** Saved data is in IndexedDB. Drafts are already restored ("Your unsaved note is back."), so an Update tap must still go through that path.
- **A version display that lies.** It must never show the server as up to date from a cached response, so `/api/health` is `no-store` and never cached by the service worker.

## Constraints

- **Dependencies** must be at least 14 days old. Action versions are pinned to commit SHAs of releases at least 14 days old, as in `ci.yml`.
- **Secrets:** `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts edit, D1 edit) and `CLOUDFLARE_ACCOUNT_ID`, set by the owner as GitHub Actions secrets. The deploy job's other Worker secrets already live in Cloudflare and aren't touched.
- **Protected paths:** `.github/workflows/**` and `scripts/` are protected. The owner approves this change to them.
- **Strings** exist in both `ko.json` and `en.json`. Both themes, both layouts.

## Approaches

1. **Chosen: Release Please plus a GitHub Actions deploy job on `release_created`.** This follows kakao-list's setup (Release Please manifest, pinned actions) with a single component. The deploy runs only for the released commit, after checks, and handles migrations.
2. **Cloudflare Workers Builds (Git integration).** Rejected: it deploys on pushes to a branch, not on a release, and doesn't run D1 migrations or the project's checks first.
3. **Deploy on every push to `main`.** Rejected: that's what the owner is moving away from.

## Decided (owner)

- Release Please, and deploys happen only when the release PR is merged.
- Updates: a visible "Update" prompt while the app is in use, applied quietly on a cold start.
- Versions and commits for both the app and the server, shown in Account.

## Designer's calls (open to correction)

- **Single Release Please component `magomap`**, versioned in the root `package.json`, starting at `0.1.0`. `bump-minor-pre-major` as in kakao-list. Tags look like `magomap-v0.1.0`. Later the extension (direct-sync plan) gets its own component.
- **How the server gets its version:** `wrangler deploy --var APP_VERSION:<v> --var APP_COMMIT:<sha7> --var APP_BUILT_AT:<iso>`. A local deploy without them reports `version "dev"`, `commit "unknown"`.
- **How the app gets its version:** Vite `define` (`__APP_VERSION__`, `__APP_COMMIT__`, `__APP_BUILT_AT__`), read from the root `package.json` and `git rev-parse` or `GITHUB_SHA`.
  - The deploy job builds the web app once and passes the **same** values to Wrangler, so one release always shows identical app and server lines.
- **Release PR checks:** CI must pass on the release PR before it can be merged. As in kakao-list, the workflow dispatches `ci.yml` for the release branch, because PRs opened by `GITHUB_TOKEN` don't trigger workflows. The deploy job also re-runs the checks.
- **PWA mechanics:**
  - `registerType: "prompt"` with `useRegisterSW` from `virtual:pwa-register/react`. Cold-start detection: the page's first 3 seconds after load. A `needRefresh` within that window calls `updateServiceWorker(true)` at once; later, it shows the banner.
  - `registration.update()` runs on **every** return to the foreground (`visibilitychange` → visible), and every 30 minutes while the app stays visible.
- **`/api/health`** keeps `ok` and `db`, and adds `version`, `commit` and `builtAt`. It sends `Cache-Control: no-store`.
- **`pnpm deploy:d1` stays** for emergencies, documented in `docs/deploy.md` as "not the normal path".

## Settled after the builder check (designer's calls)

- **Unsaved typing on Update.**
  - Tapping Update first saves the open visit-note draft at once (`NoteEditor` normally saves it 0.5 s after typing stops), then reloads.
  - The reload keeps the current URL, so she lands on the same screen, and the draft comes back when she opens the editor, as today.
  - Short inputs without drafts (list name, link, search) aren't kept. Update is a tap she chooses, never automatic while she's using the app.
- **Retrying a failed deploy.** The deploy workflow also has a manual trigger (`workflow_dispatch`) taking a tag `magomap-vX.Y.Z`. It refuses unless that tag exists and points to a release created by Release Please. This is the one allowed exception to "deploy only on release". Re-running the failed job is the first resort.
- **Release PR checks are not enforced by a branch rule.** The owner pushes docs straight to `main`, which a required-check rule would block. CI is dispatched on the release PR for visibility (`ci.yml` gains `workflow_dispatch`), and **the deploy job's own run of `scripts/checks.sh` is the gate**.
  - Owner setup: allow GitHub Actions to create pull requests (Settings → Actions → General).
- **First version.**
  - The manifest starts at `0.1.0` with `bootstrap-sha` set to `main`'s head when this lands, so the changelog starts from then, not from the whole history.
  - The first release PR proposes the next version. Use `bump-minor-pre-major` and `bump-patch-for-minor-pre-major`, as in kakao-list: before 1.0, a `feat` bumps the patch number.

## Left to the builder

- Exact wording in Korean and English for the About section, the mismatch line and the banner, following the brand guidelines' voice.
- Whether the version helper lives in `apps/web/src/version.ts` or near the Account screen.
- Banner placement in the phone and desktop layouts, consistent with the existing sync indicator.
- Test layout: unit tests for the update-timing logic, an API test for `/api/health`, and a workflow dry run where possible (`act` isn't required).
