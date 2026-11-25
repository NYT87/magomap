# Deploying magomap

magomap is one Cloudflare Worker that serves the API (and, once the app is built, the PWA). Its database is **D1** (SQLite) or **Postgres** through **Hyperdrive**. Choose one per deployment; the code is the same.

## Releases

Production changes **only when a release is made**. Pushing to `main` deploys nothing.

1. Write commits as conventional commits (`feat:`, `fix:`, `docs:`, …). **Release Please** (`.github/workflows/release.yml`) keeps a release PR open on `main` with the next version and the changelog. The version is the root `package.json` version: one version for the app and the API.
2. The workflow runs CI on that PR (PRs opened by Actions don't start CI on their own). Merge the PR when it's green.
3. Merging creates the release, tagged `magomap-v<version>`, and **that** commit is deployed in two jobs:
   - **`build`** (no secrets, no environment) runs `scripts/checks.sh`, the same checks as CI, then builds the web app with `scripts/deploy-release.sh build <version> <sha>` and keeps it as an artifact.
   - **`deploy`** (the `production` environment, which holds the Cloudflare token) runs no tests or build. It:
     - writes a D1 Time Travel bookmark to the job summary;
     - applies the D1 migrations (`pnpm db:migrate:d1 --remote`);
     - deploys the built app with `scripts/deploy-release.sh deploy <version> <sha> <built-at>`, so the app and the Worker get the same version, commit and build time;
     - checks that `/api/health` reports the release's commit.

   Any failing step stops the deploy. Repository code never runs in the job that holds the Cloudflare token.
4. Check **Account → About**: the app and server lines show the new version.

**The D1 bookmark:** the job summary says when the bookmark was taken. On a re-run of the job (after migrations already ran), the new bookmark is *not* a pre-migration one: use the bookmark from the first attempt's summary to go back to before the migrations.

**First rollout (once):** phones still run the old bundle, whose service worker was registered in auto-update mode. That client never tells a waiting worker to take over, so the first release after this change reaches a phone only after the app is fully closed (swiped away) and reopened. An open or backgrounded old app shows no banner. Tell her once to close the app and open it again. From then on the "A new version is ready" banner, or the quiet apply at cold start, works as designed.

**A failed deploy:** first re-run the failed job. Otherwise run the **Release** workflow by hand (Actions → Release → Run workflow, from `main`) with the tag, e.g. `magomap-v0.2.0`. It refuses anything that isn't a release created by Release Please on a commit on `main`.

**Rolling back:** `npx wrangler rollback --env d1`, or the Worker's Deployments page. For the data, restore the bookmark in the job summary: `npx wrangler d1 time-travel restore magomap --env d1 --bookmark=<bookmark>`.

**The extension component:** the `magomap` component covers the whole repo (path `.`) except `apps/extension`, which `release-please-config.json` excludes (`exclude-paths`) and releases as its own `extension` component (`release-type: node`). Extension commits get their own version, `apps/extension/CHANGELOG.md` and `extension-v…` tags, and never bump magomap's version. Release Please also bumps `version` in `apps/extension/manifest.json` (`extra-files: ["manifest.json"]`; a plain `.json` entry, relative to the package path, has its `$.version` updated: [release-please `src/strategies/base.ts`](https://github.com/googleapis/release-please/blob/main/src/strategies/base.ts), `extraFileUpdates` and `addPath`). Both components share the one release PR. The `deploy` job only runs for `magomap-v…` tags, so an extension release never deploys the Worker.

**Releasing the extension:** automatic. When merging a release PR creates an `extension-v…` release, the Release workflow's `extension-bundle` job (no secrets) runs the extension's tests and builds the release zip from that release's commit, and `extension-upload` attaches it to the release as `magomap-extension.zip` (replacing one already there). If it ever fails, re-run those jobs, or do it by hand:

**The release PR is made last.** The extension release is a draft until `extension-upload` publishes it, and a draft has no git tag yet. So the `release-please` job only creates releases (`skip-github-pull-request`), and the `release-pr` job makes or updates the next release PR after `extension-upload` has finished (`skip-github-release`). Before this, Release Please opened a stray "release extension X+1" PR that re-listed the changes just released (PR #56); if one ever appears again, close it without merging. If `extension-upload` fails, no release PR is made until the next push to `main`: fix the upload (re-run it), then re-run the `release-pr` job.

```bash
git checkout extension-vX.Y.Z
pnpm install --frozen-lockfile
pnpm --filter @magomap/extension bundle        # writes apps/extension/magomap-extension.zip
gh release upload extension-vX.Y.Z apps/extension/magomap-extension.zip --clobber
```

**One-time setup (owner):**
- GitHub → Settings → Actions → General: allow GitHub Actions to create pull requests.
- GitHub → Settings → Environments: create `production`, limited to the `main` branch. Add the secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, D1 edit) and `CLOUDFLARE_ACCOUNT_ID`.

The rest of this page sets up a deployment from scratch.

Requirements: Node 22, pnpm (the version in `package.json`), a Cloudflare account, and `npx wrangler login`.

## 1. Choose the database

**Current choice (2026-11-19): D1.** The first deployment uses D1, created in an Asia location (`npx wrangler d1 create magomap --location apac`) so it sits near the people using it. Moving to Postgres is to be reconsidered once the app is in real use. The deciding factor is the latency from the Worker to that server's region. Postgres-only would also allow real transactions instead of the write token, but that is a rewrite and its own plan.

### Option A: D1

```bash
npx wrangler d1 create magomap --location apac
```

- Put the printed `database_id` in `apps/api/wrangler.toml`, under `[[env.d1.d1_databases]]`.
- Apply the migrations:

  ```bash
  pnpm db:migrate:d1 --remote
  ```

- Turn on point-in-time recovery: D1 Time Travel is on by default; check the retention in the dashboard.

#### Watching D1 writes

The Free plan allows 100,000 rows written a day, and Cloudflare emails when 90% of it is used (the owner got that email on 2026-11-20). The daily count is in the dashboard under **D1 → magomap → Metrics**.

An import only writes what changed. An unchanged re-import costs tens of rows per list: in the tests, an unchanged re-import of 2 lists in 3 pages wrote 31 rows. That figure is the statements' `numAffectedRows`, so it is a lower bound: D1 also bills a write for each index entry a changed row updates (for example the `seq` indexes), so the dashboard can show more.

When someone gains a list (first import, a list followed, a list restored), the server no longer re-writes the shared rows. That phone downloads everything again once, which costs rows read and data use, not rows written. It happens only on a sync that brings that phone a new or restored list; adding places to a list it already has does not trigger it. A place someone saves that none of their lists shows still re-writes that one place's few shared rows.

Each phone also downloads everything once after updating to the app version that brought this change, because an older version never did that download when it gained a list.

### Option B: Postgres with Hyperdrive

Any Postgres 15 or newer works (Neon, Supabase, RDS, or your own).

1. Apply the migrations from your machine:

   ```bash
   DATABASE_URL="postgres://…" pnpm db:migrate:postgres
   ```

2. Create the Hyperdrive config **with caching disabled**. magomap reads its own writes right away (sync, sessions), so cached reads would be wrong:

   ```bash
   npx wrangler hyperdrive create magomap --connection-string="postgres://…" --caching-disabled
   ```

3. Put the printed id in `apps/api/wrangler.toml`, under `[[env.postgres.hyperdrive]]`.

## 2. Rate limiting

Kakao place search is limited to 60 requests a minute per user. In `apps/api/wrangler.toml`, `[[env.<env>.ratelimits]]` uses `namespace_id = "1001"`; change it to any number that isn't used by another Worker on the account.

## 3. Kakao Developers

Keep using the **Kakao Developers app the deployment already has**. Kakao gives each person a different user id per app, so another app would make existing accounts, and the ids in `ALLOWED_KAKAO_USER_IDS`, unrecognised.

In that app:

1. **Kakao Login → Redirect URI**: add `https://<your-domain>/api/auth/kakao/callback`.
2. **Platform → Web**: add `https://<your-domain>` as a site domain. It is also the JavaScript SDK domain the map needs.
3. **Kakao Maps**: set it to **ON**, and check the quota under **Statistics → Quota**. The free map quota applies only to the first app on the account with Kakao Maps on; when Kakao refuses the map, the app falls back to OpenStreetMap.
4. Note the **REST API key**, the **JavaScript key** and the **client secret** (Kakao Login → Security).

## 4. Settings and secrets

In `apps/api/wrangler.toml`, under `[env.<env>.vars]`:

| Var | Value |
|---|---|
| `KAKAO_REDIRECT_URI` | `https://<your-domain>/api/auth/kakao/callback` |
| `KAKAO_JAVASCRIPT_KEY` | the JavaScript key, which is public by design |
| `ALLOWED_KAKAO_USER_IDS` | comma-separated Kakao user ids allowed to sign up; empty means open |
| `ALLOW_DEV_LOGIN` | `"false"`, always, when deployed |
| `ALLOW_DEV_UPLOAD` | `"false"`, always, when deployed: `"true"` lets **any** signed-in user upload a Kakao Map read (see "Sync from Kakao Map") |

Secrets, which are never stored in the file:

```bash
npx wrangler secret put KAKAO_REST_API_KEY --env d1      # or --env postgres
npx wrangler secret put KAKAO_CLIENT_SECRET --env d1
npx wrangler secret put SIGNING_SECRET --env d1          # signs search results: openssl rand -hex 32
```

Generate real secrets; never reuse the values in `.dev.vars.example`.

## 5. Emergency deploy

Releases deploy themselves (see "Releases" above). Deploying by hand is **not the normal path**: only for the first deployment, an emergency, or Postgres, which CI doesn't deploy.

```bash
pnpm deploy:d1        # builds the app, then deploys; or: pnpm deploy:postgres
curl https://<your-domain>/api/health   # → {"ok":true,"db":"d1","version":"dev","commit":"unknown",…}
```

**The Postgres setup deploys to its own Worker, `magomap-postgres`**, never over the live `magomap` one. Before its first real deploy:
- set its own secrets with `--env postgres`;
- set its `KAKAO_REDIRECT_URI` to its own `workers.dev` host (`https://magomap-postgres.<subdomain>.workers.dev/api/auth/kakao/callback`), and register that URI in the Kakao console;
- fill `ALLOWED_KAKAO_USER_IDS` under `[env.postgres.vars]`. Empty means open sign-up;
- set `ALLOW_DEV_UPLOAD = "false"` under `[env.postgres.vars]` (it is `"true"` there for local development).

A hand deploy reports version `dev` and commit `unknown` from the server, so it is easy to tell apart from a release.

To roll back, run `npx wrangler rollback --env d1`, or use the Worker's Deployments page.

## Sync from Kakao Map

Account → "Sync from Kakao Map" reads her Kakao Map lists through the magomap browser extension (`apps/extension`) and uploads them to `/api/import/kakao-map/*`.

- **Who may upload:** only users whose Kakao id is in a **non-empty** `ALLOWED_KAKAO_USER_IDS`. An empty list refuses every upload (`not_allowed`), even though it opens sign-up. `ALLOW_DEV_UPLOAD = "true"` lifts that check for local development and tests only; it is `"false"` in `[env.d1.vars]` and must be `"false"` in any deployed Worker.
- **The extension:** released under its own Release Please component (tags `extension-v…`, see "The extension component" above), as `magomap-extension.zip` on the GitHub release, attached automatically (see "Releasing the extension" above). To install it on her computer: unzip it, open `chrome://extensions` (or `brave://extensions`), turn on **Developer mode**, **Load unpacked** the folder, and check the id is `eccgkehfioodkgllihgbgkgfcifmghif`. The release build only answers `https://magomap.jmn8718.workers.dev`; a different domain needs its origin in `apps/extension/src/origins.ts`. Details in [apps/extension/README.md](../apps/extension/README.md).
- **The extension id** is fixed by the key in `apps/extension/manifest.json`, and the web app uses it by default. `VITE_MAGOMAP_EXTENSION_ID` (build time, `apps/web/.env.example`) overrides it, only for a build with another key.

## Exporting one user's data

Each user exports their own data: **Account → Download my data** (the web app calls `GET /api/me/export` with their session, so it works on both databases and needs nothing from the operator). It saves `magomap-export-YYYY-MM-DD.json`:

- `mine`: their saved places, notes, links, own lists with items, and list memberships.
- `shared`: the places (with sources and locations) and followed Kakao lists they reach through those, kept apart because other people can see them too.
- Never in it: another user's notes, links or saved places, sessions, and server-only columns (`provider_owner_id`, `color_edited_at`). Deleted rows are left out.

The export is built in memory from user-scoped queries read 500 rows at a time (no whole-table scans, so D1 rows read stay proportional to the account), then sent as one response. An account of a few thousand places is far inside the Worker's limits. There is no operator-side command: nobody but the account's owner can export it, as no one else has its session. Account deletion (**Account → Delete account**) is covered by tests for both databases (`packages/db/src/stores/users.test.ts`).

## Daily clean-up

Each Worker has a **Cron Trigger** (`[env.<name>.triggers]` in `apps/api/wrangler.toml`, 03:17 UTC daily) that runs `scheduled` in `apps/api/src/scheduled.ts`. It closes import runs that have been `running` for more than 7 days (as `superseded`) and deletes their pages and lists, so an import someone stopped halfway doesn't leave rows behind. A closed run refuses further pages, so their next import starts fresh. The log line "Closed N abandoned import run(s)." shows in the Worker's logs. The trigger is registered by a deploy; Cron Triggers run on the Free plan.

## Workers plan

Every request is designed to fit the **Free** plan's limits:
- an import is sent one list at a time, in pieces of up to 500 places;
- a sync push carries at most 200 changes or 1 MB.

If importing a very large Kakao list still hits the CPU limit, the fix is **Workers Paid**.

## Local development

```bash
docker compose up -d postgres                   # only for Postgres tests
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:d1 --local
pnpm --filter @magomap/api dev                  # wrangler dev --env d1 on :8787
pnpm --filter @magomap/api dev:seed             # dev login + a small Kakao Map sync
```

To try "Sync from Kakao Map" locally, load the extension's dev build (`pnpm --filter @magomap/extension build:dev`, then **Load unpacked** `apps/extension/dist`), sign in to Kakao Map in that browser, and allow uploads for the dev login: `pnpm --filter @magomap/api exec wrangler dev --env d1 --var ALLOW_DEV_UPLOAD:true`, or run `--env postgres`, where `ALLOW_DEV_UPLOAD` is already `"true"`.
