# Deploying magomap

magomap is one Cloudflare Worker that serves the API (and, once the app is built, the PWA). Its database is **D1** (SQLite) or **Postgres** through **Hyperdrive**. Choose one per deployment; the code is the same.

## Releases

Production changes **only when a release is made**. Pushing to `main` deploys nothing.

1. Write commits as conventional commits (`feat:`, `fix:`, `docs:`, …). **Release Please** (`.github/workflows/release.yml`) keeps a release PR open on `main` with the next version and the changelog. The version is the root `package.json` version: one version for the app and the API.
2. The workflow runs CI on that PR (PRs opened by Actions don't start CI on their own). Merge the PR when it's green.
3. Merging creates the release, tagged `magomap-v<version>`, and the `deploy` job deploys **that** commit. In order, it:
   - runs `scripts/checks.sh`, the same checks as CI;
   - writes a D1 Time Travel bookmark to the job summary;
   - applies the D1 migrations (`pnpm db:migrate:d1 --remote`);
   - builds and deploys with `scripts/deploy-release.sh <version> <sha>`, which gives the app and the Worker the same version, commit and build time;
   - checks that `/api/health` reports the release's commit.

   Any failing step stops the deploy.
4. Check **Account → About**: the app and server lines show the new version.

**The D1 bookmark:** the job summary says when the bookmark was taken. On a re-run of the job (after migrations already ran), the new bookmark is *not* a pre-migration one: use the bookmark from the first attempt's summary to go back to before the migrations.

**First rollout (once):** phones still run the old bundle, whose service worker was registered in auto-update mode. That client never tells a waiting worker to take over, so the first release after this change reaches a phone only after the app is fully closed (swiped away) and reopened. An open or backgrounded old app shows no banner. Tell her once to close the app and open it again. From then on the "A new version is ready" banner, or the quiet apply at cold start, works as designed.

**A failed deploy:** first re-run the failed job. Otherwise run the **Release** workflow by hand (Actions → Release → Run workflow, from `main`) with the tag, e.g. `magomap-v0.2.0`. It refuses anything that isn't a release created by Release Please on a commit on `main`.

**Rolling back:** `npx wrangler rollback --env d1`, or the Worker's Deployments page. For the data, restore the bookmark in the job summary: `npx wrangler d1 time-travel restore magomap --env d1 --bookmark=<bookmark>`.

**One-time setup (owner):**
- GitHub → Settings → Actions → General: allow GitHub Actions to create pull requests.
- GitHub → Settings → Environments: create `production`, limited to the `main` branch. Add the secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, D1 edit) and `CLOUDFLARE_ACCOUNT_ID`.

The rest of this page sets up a deployment from scratch.

Requirements: Node 22, pnpm (the version in `package.json`), a Cloudflare account, and `npx wrangler login`.

## 1. Choose the database

**Current choice (2026-11-19): D1.** The first deployment uses D1, created in an Asia location (`npx wrangler d1 create magomap --location apac`) so it sits near the people using it. Moving to Postgres (for example a separate database on the server kakao-list uses) is to be reconsidered once the app is in real use. The deciding factor is the latency from the Worker to that server's region. Postgres-only would also allow real transactions instead of the write token, but that is a rewrite and its own plan.

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

Use the **same Kakao Developers app as kakao-list**. Kakao gives each person a different user id per app, so a different app would break the import.

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
| `KAKAO_LIST_URL` | the deployed kakao-list server, e.g. `https://kakao-list-api.vercel.app` |
| `ALLOW_DEV_LOGIN` | `"false"`, always, when deployed |

Secrets, which are never stored in the file:

```bash
npx wrangler secret put KAKAO_REST_API_KEY --env d1      # or --env postgres
npx wrangler secret put KAKAO_CLIENT_SECRET --env d1
npx wrangler secret put MAGOMAP_IMPORT_SECRET --env d1   # at least 32 characters: openssl rand -hex 32
npx wrangler secret put SIGNING_SECRET --env d1          # signs search results: openssl rand -hex 32
```

Set **the same** `MAGOMAP_IMPORT_SECRET` on the kakao-list server. Generate real secrets; never reuse the values in `.dev.vars.example`.

## 5. Emergency deploy

Releases deploy themselves (see "Releases" above). Deploying by hand is **not the normal path**: only for the first deployment, an emergency, or Postgres, which CI doesn't deploy.

```bash
pnpm deploy:d1        # builds the app, then deploys; or: pnpm deploy:postgres
curl https://<your-domain>/api/health   # → {"ok":true,"db":"d1","version":"dev","commit":"unknown",…}
```

A hand deploy reports version `dev` and commit `unknown` from the server, so it is easy to tell apart from a release.

To roll back, run `npx wrangler rollback --env d1`, or use the Worker's Deployments page.

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
pnpm --filter @magomap/api dev:fake-kakao-list  # a stand-in kakao-list on :8788
pnpm --filter @magomap/api dev:seed             # dev login + a full import
```
