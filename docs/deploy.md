# Deploying magomap

magomap is one Cloudflare Worker that serves the API (and, once the app is built, the PWA). Its database is **D1** (SQLite) or **Postgres** through **Hyperdrive**. Choose one per deployment; the code is the same.

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

## 5. Deploy

```bash
pnpm deploy:d1        # builds the app, then deploys; or: pnpm deploy:postgres
curl https://<your-domain>/api/health   # → {"ok":true,"db":"d1"}
```

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
