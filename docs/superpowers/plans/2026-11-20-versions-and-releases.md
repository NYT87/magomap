# Versions, releases and app updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Account shows the app's and the server's version, commit and build time. The installed app offers new versions with an Update prompt, and applies them quietly on a cold start. Production deploys happen only when a Release Please PR is merged.

**Architecture:**
- **One set of build values for both halves.** A release build stamps `version` (root `package.json`), `commit` (7 characters) and `builtAt` (ISO time) into the web app through Vite `define`. The same values go to the Worker through `wrangler deploy --var`, and `/api/health` reports them.
- **Updates.** The service worker switches to `registerType: "prompt"`. A small `update/` module decides between "apply now" (cold start) and "prompt" (in use), checks on every return to the foreground and every 30 minutes while visible, and saves the open note draft before reloading.
- **Releases.** Release Please manages one root component, `magomap`. A workflow deploys the released commit after `scripts/checks.sh`, a D1 bookmark and migrations.

**Tech Stack:** Vite 8 + vite-plugin-pwa (`virtual:pwa-register/react`), React 19, Hono on Workers, Wrangler, GitHub Actions, googleapis/release-please-action, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-versions-and-releases-design.md`. Read it, including "Settled after the builder check".

## Global Constraints

- **Build values:**
  - `version` is the root `package.json` version.
  - `commit` is the first 7 characters of `APP_COMMIT`, or of `GITHUB_SHA`, or else `git rev-parse --short=7 HEAD`; failing all of those, `"unknown"`.
  - `builtAt` is `APP_BUILT_AT`, or else the build's own time, as ISO 8601.
  - A Worker deployed without these values reports `version: "dev"`, `commit: "unknown"`, `builtAt: null`.
- **`/api/health`** returns `{ ok, db, version, commit, builtAt }` with `Cache-Control: no-store`. The service worker never caches `/api/*` (`navigateFallbackDenylist` already covers navigations; add no runtime cache for it).
- **Update timing:**
  - Cold-start window: **3000 ms** after page load. A new version found inside it is applied at once; after it, she is prompted.
  - Checks run on **every** `visibilitychange` to visible, and every **30 minutes** while the app stays visible.
  - The app **never reloads by itself** after the cold-start window.
- **Releases:**
  - Release Please `release-type: node`, package path `.`, component `magomap`, `include-component-in-tag: true`, `include-v-in-tag: true` (tags `magomap-v0.1.1`), `bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: true`.
  - The manifest starts at `0.1.0`, and `bootstrap-sha` is `main`'s head when Task 4 lands.
- **Actions** are pinned to commit SHAs of releases at least 14 days old, with the version in a comment, as in `ci.yml`. Use the same SHAs as `ci.yml` for checkout, pnpm and setup-node. Use `googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0` (the SHA kakao-list uses).
- **Secrets** used by workflows: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Never echo them.
- **Protected paths:** `.github/workflows/**` and `scripts/` change in Task 4 only, with the owner's approval as stated in the spec.
- **Strings** exist in both `ko.json` and `en.json`. Both themes, both layouts. Touch targets are at least 44 px.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh`. While the `map-provider` worktree exists in `.claude/worktrees/`, Biome fails on its nested config. Run the gate's steps one by one, excluding it, and say so in the task notes.
- **Commits** use conventional prefixes, because Release Please reads them, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `main` (owner's choice).

## Review Focus

- **A phone running an older cached app** shows two different commits and an Update button. Pinned in Task 2 (mismatch line) and Task 3 (button appears when an update is waiting).
- **Update tapped while a visit note is half-typed:** the draft is saved before the reload and comes back in the editor. Pinned in Task 3.
- **Offline, or the server not answering:** the About section says the server is offline and shows no stale version. Pinned in Task 2.
- **A new version found 10 s after opening:** prompt only, never a reload under her. Pinned in Task 3's timing tests.
- **A failed deploy step** (checks, migration or Wrangler) stops before anything later runs, and a manual re-deploy refuses a tag that isn't a Release Please `magomap-v*` tag. Pinned in Task 4 by the job's `needs`/`if` structure and a guard step, checked with `actionlint`.

---

### Task 1: The server reports its version

**Files:**
- Modify:
  - `apps/api/src/env.ts`: optional `APP_VERSION?: string; APP_COMMIT?: string; APP_BUILT_AT?: string`;
  - `apps/api/src/index.ts`, the `/health` route;
  - `packages/domain/src/api.ts`: export `BuildInfo`;
  - `apps/api/test/auth.test.ts`, the `/api/health` test.

**Interfaces:**
- Produces:
  - `export interface BuildInfo { version: string; commit: string; builtAt: string | null }`, from `@magomap/domain`;
  - `GET /api/health` returns `{ ok: true, db: string } & BuildInfo`.

- [ ] **Step 1: Write the failing tests:**
  - `reports the build on /api/health`: called with overrides `{ APP_VERSION: "0.1.1", APP_COMMIT: "a1b2c3d", APP_BUILT_AT: "2026-11-20T05:02:00.000Z" }`, the body equals `{ ok: true, db: <driver>, version: "0.1.1", commit: "a1b2c3d", builtAt: "2026-11-20T05:02:00.000Z" }`, and `cache-control` is `no-store`.
  - `reports a dev build without them`: gives `version: "dev"`, `commit: "unknown"`, `builtAt: null`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/api test -- auth`. Expected: FAIL.
- [ ] **Step 3: Implement it** in the `/health` handler, setting the `no-store` header.
- [ ] **Step 4: Run the tests again.** Expected: PASS. Run `wrangler dev --env postgres --var APP_VERSION:0.1.1`, `curl` `/api/health` once, and check the body.
- [ ] **Step 5: Commit** with `feat(api): report the server's version on /api/health`.

### Task 2: The app knows its version; Account shows both

**Files:**
- Create:
  - `apps/web/build-info.ts`: Node-side, used by `vite.config.ts`;
  - `apps/web/src/version.ts` and `apps/web/src/env.d.ts` (declares the three globals);
  - `apps/web/src/screens/AboutSection.tsx` and `AboutSection.test.tsx`.
- Modify:
  - `apps/web/vite.config.ts`: add `define`;
  - `apps/web/src/screens/Account.tsx`: render `<AboutSection />` after the language card, before the actions;
  - `ko.json` and `en.json`.

**Interfaces:**
- Consumes Task 1's `BuildInfo` and `/api/health`.
- Produces:

  ```ts
  // apps/web/build-info.ts
  export function readBuildInfo(env?: NodeJS.ProcessEnv): BuildInfo;    // rules in Global Constraints
  // apps/web/src/version.ts
  export const APP_BUILD: BuildInfo;                                     // from __APP_VERSION__, __APP_COMMIT__, __APP_BUILT_AT__
  export function useServerBuild(): { state: "loading" } | { state: "offline" } | { state: "ok"; build: BuildInfo };
  ```

  `useServerBuild` fetches `/api/health` with `cache: "no-store"`. It refetches when the browser comes back online. It never reads a cached value.

- [ ] **Step 1: Write the failing tests:**
  - `build-info.test.ts` (next to `build-info.ts`, run by the web Vitest):
    - `prefers APP_COMMIT, then GITHUB_SHA, cut to 7`;
    - `falls back to git, then "unknown"`, with git stubbed to throw;
    - `uses APP_BUILT_AT when set`;
    - `reads the root package version`.
  - `AboutSection.test.tsx`:
    - `shows the app and server lines`: with `APP_BUILD` mocked to `0.1.1 · a1b2c3d` and a health stub with the same values, both lines read "0.1.1 · a1b2c3d" with a formatted build time.
    - `says when the app is older than the server`: different commits show the mismatch line.
    - `says the server is offline`: a failing fetch shows the offline line and no server version.
    - `values are plain selectable text`: they are in a `<code>` element, not a button.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **Strings, my proposal:**

    | key | ko | en |
    |---|---|---|
    | `about.title` | 버전 정보 | About |
    | `about.app` | 앱 | App |
    | `about.server` | 서버 | Server |
    | `about.built` | {{date}} 빌드 | built {{date}} |
    | `about.mismatch` | 앱이 서버보다 오래된 버전이에요. 업데이트하면 최신 버전을 쓸 수 있어요. | The app is older than the server. Update to get the latest. |
    | `about.offline` | 서버: 연결 안 됨 | Server: offline |
  - The Update button in this section comes in Task 3. Leave a slot (`children`) for it.
- [ ] **Step 4: Run** the tests and the gate steps. Expected: PASS. Run `pnpm --filter @magomap/web build`, grep `dist/` for the commit to confirm it is stamped, and open Account in `pnpm dev` once.
- [ ] **Step 5: Commit** with `feat(web): show the app's and the server's version in Account`.

### Task 3: Updates — prompt in use, quiet on a cold start

**Files:**
- Create in `apps/web/src/update/`:
  - `timing.ts` and `timing.test.ts`;
  - `beforeUpdate.ts` and `beforeUpdate.test.ts`;
  - `useAppUpdate.ts`, `UpdateBanner.tsx` and `UpdateBanner.test.tsx`.
- Modify:
  - `apps/web/vite.config.ts`: `registerType: "prompt"`;
  - `apps/web/src/main.tsx`: drop `registerSW`; registration moves into `useAppUpdate`;
  - `apps/web/src/App.tsx`: render `<UpdateBanner />` next to the sync indicator;
  - `apps/web/src/screens/AboutSection.tsx`: an Update button when an update is waiting;
  - `apps/web/src/place/NoteEditor.tsx`: register its flush;
  - `ko.json` and `en.json`.

**Interfaces:**
- Produces:

  ```ts
  // update/timing.ts
  export const COLD_START_MS = 3000;
  export const CHECK_EVERY_MS = 30 * 60 * 1000;
  export function onUpdateFound(sinceLoadMs: number): "apply" | "prompt";
  export function dueForCheck(nowMs: number, lastCheckMs: number): boolean;   // true when ≥ CHECK_EVERY_MS
  // update/beforeUpdate.ts
  export function registerBeforeUpdate(fn: () => Promise<void>): () => void;  // returns unregister
  export function runBeforeUpdate(timeoutMs?: number): Promise<void>;         // awaits all, at most timeoutMs (default 2000), never rejects
  // update/useAppUpdate.ts — one registration for the whole app (module-level store + hook)
  export function useAppUpdate(): { waiting: boolean; update: () => Promise<void>; dismissed: boolean; dismiss: () => void };
  ```

- [ ] **Step 1: Write the failing tests:**
  - `timing.test.ts`:
    - `applies inside the cold-start window`: `onUpdateFound(0)` and `onUpdateFound(2999)` give `"apply"`.
    - `prompts after it`: `onUpdateFound(3000)` and `onUpdateFound(10_000)` give `"prompt"`.
    - `checks every 30 minutes`: `dueForCheck(t + 29 * 60_000, t)` is false; `dueForCheck(t + 30 * 60_000, t)` is true.
  - `beforeUpdate.test.ts`:
    - `runs every registered hook and waits for them`;
    - `unregistered hooks don't run`;
    - `a hook that rejects or hangs doesn't block`: it resolves within `timeoutMs`.
  - `UpdateBanner.test.tsx`, with `virtual:pwa-register/react` mocked:
    - `no banner without a waiting update`;
    - `banner says a new version is ready, and Update runs the hooks then updateServiceWorker(true)`;
    - `Dismiss hides it for the session`;
    - `an update found within the first 3 s applies at once, without a banner`;
    - `returning to the foreground asks the registration to check every time`: two `visibilitychange` → visible events give two `registration.update()` calls.
  - Extend the `NoteEditor` tests: `Update saves the half-typed note`. Type into the editor, call `runBeforeUpdate()` before 500 ms pass, and the draft is in `db.drafts`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Use `useRegisterSW` with `immediate: true`.
    - In `onRegisteredSW`, keep the registration. Call `registration.update()` on each `visibilitychange` to visible, and on a 1-minute interval that calls it only when `dueForCheck` says so and `document.visibilityState === "visible"`.
    - On `needRefresh`, use `onUpdateFound(performance.now())`.
  - `update()` runs `await runBeforeUpdate()`, then `updateServiceWorker(true)`, which reloads at the same URL.
  - The banner uses `role="status"`, at least 44 px targets, and the sync indicator's placement on phone and desktop.
  - **Strings, my proposal:**

    | key | ko | en |
    |---|---|---|
    | `update.ready` | 새 버전이 준비됐어요 | A new version is ready |
    | `update.now` | 업데이트 | Update |
    | `update.later` | 나중에 | Later |
- [ ] **Step 4: Run** the tests and the gate steps. Expected: PASS. Check it in a browser:
  1. `pnpm --filter @magomap/web build && pnpm --filter @magomap/web preview`, then open the app.
  2. Change a string, rebuild, and switch tabs away and back. The banner appears.
  3. Tap Update. It reloads on the same screen.
  4. Save screenshots of the banner to `tmp/review-shots/versions-3/` (phone and desktop, light and dark).
- [ ] **Step 5: Commit** with `feat(web): offer new versions with an Update prompt`.

### Task 4: Release Please and deploy on release

**Files:**
- Create:
  - `release-please-config.json` and `.release-please-manifest.json` (`{ ".": "0.1.0" }`);
  - `.github/workflows/release.yml`;
  - `scripts/deploy-release.sh`.
- Modify:
  - root `package.json`: `"version": "0.1.0"`;
  - `.github/workflows/ci.yml`: add `workflow_dispatch:`;
  - `docs/deploy.md`: a new "Releases" section first; `pnpm deploy:d1` becomes "Emergency deploy";
  - `README.md`: one line on releases.

**Interfaces:**
- Consumes Task 1's `APP_*` vars and Task 2's `readBuildInfo` environment (`APP_COMMIT`, `APP_BUILT_AT`).
- **`scripts/deploy-release.sh <version> <sha>`:**
  - It exits non-zero on any failure (`set -euo pipefail`) and never prints secrets.
  - It exports `APP_COMMIT=${sha:0:7}` and `APP_BUILT_AT=$(date -u +%FT%TZ)`, then runs `pnpm --filter @magomap/web build`.
  - It then runs `pnpm --filter @magomap/api exec wrangler deploy --env d1 --var APP_VERSION:<version> --var APP_COMMIT:<sha7> --var APP_BUILT_AT:<same time>`.
  - It fails if `<version>` doesn't match the root `package.json` version.
- **`release.yml`:**
  - Triggers: `push` to `main`, and `workflow_dispatch` with input `tag`. Concurrency group `release`, `cancel-in-progress: false`.
  - Job `release-please` (only on `push`): runs the action with the two files, and outputs `release_created`, `tag_name`, `sha` and `version`. For a root package these are the action's top-level outputs; confirm in the action's README and record the URL in the commit. It then dispatches `ci.yml` on the open release PR's branch, the way kakao-list's `verify-release-pr` does, but without the update-branch step.
  - Job `deploy` (`needs: release-please`, or the dispatch). It runs only if `release_created == 'true'` or the event is `workflow_dispatch`. It uses `environment: production`. Its steps:
    1. **Resolve and guard.** On dispatch, the tag must match `^magomap-v\d+\.\d+\.\d+$`, `gh release view <tag>` must succeed, and the SHA is the tag's commit.
    2. Check out that SHA.
    3. Run pnpm, set up Node, and `pnpm install --frozen-lockfile`.
    4. Run `bash scripts/checks.sh`, with the same Postgres service and `TEST_DATABASE_URL` as `ci.yml`.
    5. Run `wrangler d1 time-travel info magomap --env d1` and append the bookmark to `$GITHUB_STEP_SUMMARY`.
    6. Run `pnpm db:migrate:d1`, with `CI=true` so Wrangler doesn't prompt.
    7. Run `bash scripts/deploy-release.sh <version> <sha>`.
    8. Run `curl -fsS https://magomap.jmn8718.workers.dev/api/health` and fail unless `.commit` equals `<sha7>`. Write the result to the summary.

    Env: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from secrets.
  - Permissions: `contents: write`, `pull-requests: write` and `actions: write` for `release-please`; `contents: read` for `deploy`.

- [ ] **Step 1: Write the release files and the script.** Set `bootstrap-sha` to `git rev-parse origin/main` at that moment.
- [ ] **Step 2: Check them locally:**
  - Run `actionlint .github/workflows/*.yml`, via `go run github.com/rhysd/actionlint/cmd/actionlint@<a release at least 14 days old>`, or the release binary. Expected: no errors.
  - Run `bash -n scripts/deploy-release.sh` and `shellcheck scripts/deploy-release.sh` if available.
  - Run `node -e` to parse both JSON files.
  - Run `bash scripts/deploy-release.sh 9.9.9 abc` and expect it to fail on the version mismatch **before** building.
- [ ] **Step 3: Run** the gate steps. Expected: PASS. The protected-path check fails by design; note "owner-approved (spec: Constraints)".
- [ ] **Step 4: Commit** with `ci: release with Release Please and deploy only released versions`.

### Task 5: First release (owner)

- [ ] **Step 1:** Add the GitHub secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit; scoped to the account) and `CLOUDFLARE_ACCOUNT_ID`. Create the `production` environment.
- [ ] **Step 2:** Settings → Actions → General: allow GitHub Actions to create and approve pull requests.
- [ ] **Step 3:** Push `main`. Release Please opens "chore(main): release magomap 0.1.1", and CI runs on it.
- [ ] **Step 4:** Merge it. The deploy job runs. Check its summary (bookmark, health commit), then open Account on the phone:
  - the server line shows the new version;
  - the app updates quietly on a cold start, or shows the Update banner if it was already open.
