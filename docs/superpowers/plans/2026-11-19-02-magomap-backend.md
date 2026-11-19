# magomap Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker API for magomap. It covers Kakao sign-in, offline sync (push/pull), the Kakao import from `kakao-list`, and Kakao place search. It runs on D1 or Postgres behind one database connector.

**Architecture:** This is a pnpm monorepo in `/home/motoko/workspace/magomap`, with these packages:
- `packages/domain` holds the wire types and zod schemas shared with the PWA.
- `packages/db` holds the Kysely schema, migrations for both dialects, the `Db` connector, and every data-access "store". All the logic that touches the database lives there, so the same tests run against SQLite and Postgres.
- `apps/api` is a thin Hono Worker. It parses requests, calls stores, and serves the PWA build as static assets (the PWA is added in plan 03).

**Tech Stack:** TypeScript (strict), Hono, Kysely, `kysely-d1`, `pg` (Kysely `PostgresDialect`, through Hyperdrive with `nodejs_compat`), `better-sqlite3` (tests and local dev only), zod, `uuid` (v7), Vitest, `@cloudflare/vitest-pool-workers`, Wrangler, Biome.

**Spec:** `/home/motoko/workspace/magomap/docs/superpowers/specs/2026-11-19-magomap-design.md`

**Depends on:** nothing to start. The import task builds against a fake `kakao-list` server, and works for real once plan 01 is deployed.

## Global Constraints

- The pnpm workspace sets `minimumReleaseAge: 20160` (14 days) in `pnpm-workspace.yaml`. Biome is configured at the root. Node 22.
- **Every query is scoped by `user_id`.** No store function accepts a query without a `userId`.
- **D1 limits:**
  - at most 100 bound parameters per statement;
  - no interactive transactions, so use `Db.atomic` (a D1 batch, or a Postgres transaction);
  - keep one request to at most 50 statements, because of the Workers Free per-invocation query cap.
- **Workers Free CPU:** about 10 ms per request. No request may parse or transform more than one Kakao list or one 200-mutation push.
- Ids:
  - Places use a **deterministic** id: `kp_<kakaoPlaceId>` for Kakao places, `kf_<favoriteSeq>` for custom pins. The same Kakao place from search, import or another device is therefore the same row, and no merge step is needed.
  - Kakao memberships are `ki_<kakaoFolderId>_<favoriteSeq>`, Kakao lists are `kl_<kakaoFolderId>`, and diary entries imported from kakao-list are `kn_<placeId>_<kakaoFolderId>`.
  - Everything else is a client-generated UUIDv7.
  - Primary keys are `(user_id, id)`.
- Timestamps are integer epoch ms. Booleans are 0/1 integers. Dates (`visited_on`) are `YYYY-MM-DD` text.
- Limits:
  - diary body ≤ 20,000 chars;
  - link URL ≤ 2,048 chars, `http:` or `https:` only;
  - link title ≤ 300 chars;
  - list name ≤ 100 chars;
  - push ≤ 200 mutations;
  - pull page ≤ 500 rows per table.
- Session cookie: `mm_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`. It lasts 30 days and slides: the expiry is extended when less than 15 days remain. Only the SHA-256 hash of the token is stored.
- Environment variables:
  - `DB_DRIVER` (`d1` | `postgres`), with the `DB` binding (D1) or the `HYPERDRIVE` binding;
  - `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`, `KAKAO_JAVASCRIPT_KEY`;
  - `ALLOWED_KAKAO_USER_IDS` (comma-separated; empty means open);
  - `KAKAO_LIST_URL`, `MAGOMAP_IMPORT_SECRET`;
  - `ALLOW_DEV_LOGIN` (`true` only locally).
- The Kakao app must be the **same Kakao Developers app** as kakao-list.

## Review Focus

- **The same diary entry pushed twice** (a retry after a timeout). Expect one row and an `applied`-equivalent result both times, with no duplicate. Tested in Task 4.
- **A diary entry pushed for a place another device deleted.** Expect the place to be restored (`deleted_at` null) and the entry kept. Tested in Task 4.
- **A stale edit arriving after a newer one** (a phone comes back online with an edit older than one the laptop already made). Expect the newer edit to stay, and the stale mutation to be reported as `ignored_stale`, not as an error. Tested in Task 4.
- **A partial kakao-list import** (`complete: false`, or a run never completed). Expect no list to be marked removed; memberships missing from a list that *was* uploaded are still marked removed. Tested in Task 5.
- **A large Kakao list** (3,000 favourites in one list). Expect it to import within D1's 100-parameter and statement limits. Tested in Task 5 with a statement and parameter counter.

---

### Task 1: Monorepo, domain wire types and schemas

**Files:**
- Create (repo setup):
  - root `package.json` (scripts `build`, `test`, `typecheck`, `check`);
  - `pnpm-workspace.yaml` (packages `apps/*`, `packages/*`; `minimumReleaseAge: 20160`);
  - `biome.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc` (`22`).
- Create in `packages/domain/src/`:
  - `rows.ts`, `sync.ts`, `importContract.ts`, `api.ts`, `ids.ts`, `index.ts`;
  - `sync.test.ts`.

**Interfaces (Produces, used by every later task and by plan 03):**

```ts
// rows.ts  (wire format, camelCase)
type SyncTable = "places" | "lists" | "list_items" | "visit_notes" | "links";
interface Base { id: string; createdAt: number; updatedAt: number; deletedAt: number | null; seq?: number }
interface PlaceRow extends Base { kakaoPlaceId: string | null; title: string; address: string | null; roadAddress: string | null;
  category: string | null; phone: string | null; lat: number | null; lng: number | null; source: "kakao_import" | "search" }
interface ListRow extends Base { kind: "kakao" | "own"; kakaoFolderId: number | null; subscribed: boolean; ownerName: string | null;
  name: string; description: string | null; color: string | null; removedFromKakaoAt: number | null }
interface ListItemRow extends Base { listId: string; placeId: string; position: number; addedAt: number;
  kakaoFavoriteSeq: string | null; kakaoNote: string | null; kakaoColor: string | null; removedFromKakaoAt: number | null }
interface VisitNoteRow extends Base { placeId: string; visitedOn: string | null; body: string;
  origin: "user" | "kakao_list"; originKey: string | null; editedByUser: boolean }
interface LinkRow extends Base { placeId: string; url: string; title: string | null }
type RowOf<T extends SyncTable> = /* mapping above */;

// sync.ts
interface Mutation { mutationId: string; table: SyncTable; op: "upsert" | "delete"; id: string; row?: unknown; clientUpdatedAt: number }
type MutationStatus = "applied" | "ignored_stale" | "rejected";
interface PushRequest { mutations: Mutation[] }                       // 1..200
interface PushResponse { results: { mutationId: string; status: MutationStatus; reason?: string }[] }
interface PullResponse { rows: { table: SyncTable; row: PlaceRow | ListRow | ListItemRow | VisitNoteRow | LinkRow }[]; cursor: string; hasMore: boolean }
const pushRequestSchema, mutationRowSchemas: Record<SyncTable, ZodType>;

// importContract.ts — verbatim shape from the spec, plus zod schema
interface MagomapImportContract { contractVersion: 1; kakaoUserId: string; importedAt: string; complete: boolean; lists: ImportList[] }
interface ImportList { kakaoFolderId: number; name: string; description?: string; icon?: string; subscribed: boolean; ownerName?: string; items: ImportItem[] }
interface ImportItem { favoriteSeq: string; placeKey?: string; title: string; address?: string; category?: string; phone?: string;
  lat?: number; lng?: number; kakaoNote?: string; kakaoColor?: string; localNote?: string; position: number }
const importListSchema: ZodType<ImportList>;
interface ImportSummary { listsAdded: number; listsUpdated: number; listsRemoved: number; placesAdded: number;
  membershipsRemoved: number; membershipsRestored: number; notesImported: number }

// api.ts
interface Me { userId: string; displayName: string | null; identities: { provider: "kakao" | "google" }[] }
interface PublicConfig { kakaoJavascriptKey: string | null }
interface SearchResult { kakaoPlaceId: string; title: string; address: string | null; roadAddress: string | null;
  category: string | null; phone: string | null; lat: number; lng: number }

// ids.ts
function newId(): string;                         // UUIDv7
function kakaoPlaceRowId(kakaoPlaceId: string): string;  // "kp_<id>"
function customPinRowId(favoriteSeq: string): string;    // "kf_<seq>"
```

- [ ] **Step 1: Write the failing tests** in `sync.test.ts`.
  - `pushRequestSchema` rejects 0 and 201 mutations.
  - It rejects a link with `url: "javascript:alert(1)"`.
  - It rejects a visit note with `visitedOn: "2026-13-01"`.
  - It accepts a valid visit-note upsert.
  - `kakaoPlaceRowId("123") === "kp_123"`.
  - `newId()` returns 36 characters, and the version digit is `7`.

- [ ] **Step 2: Run** `pnpm -r test`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and schemas, using the limits from Global Constraints.
- [ ] **Step 4: Run** `pnpm -r test && pnpm typecheck && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(domain): wire types and validation for sync and import`.

### Task 2: Database connector, schema and migrations

**Files:**
- Create in `packages/db/src/`:
  - `schema.ts` (the Kysely `Database` interface, snake_case columns);
  - `connector.ts`;
  - `migrations/0001_init.sqlite.sql`, `migrations/0001_init.postgres.sql`;
  - `migrate.ts`;
  - `testing/dbs.ts`, `connector.test.ts`.
- Create `packages/db/scripts/migrate.ts`, the CLI used by `pnpm db:migrate`.

**Tables:** as in the spec's data model.
- Each syncable table also has `client_updated_at INTEGER NOT NULL` and `seq INTEGER NOT NULL`, with an index on `(user_id, seq, id)`.
- `users(id, display_name, change_seq, created_at)`.
- `identities(user_id, provider, provider_user_id, created_at)`, unique on `(provider, provider_user_id)`.
- `sessions(token_hash PK, user_id, expires_at, created_at)`.
- `import_runs(user_id, id, started_at, finished_at, status, complete, summary_json, error)`.
- Postgres uses `BIGINT` for ms timestamps and `seq`.

**Interfaces:**

```ts
interface Db {
  kysely: Kysely<Database>;
  dialect: "sqlite" | "postgres";
  /** Runs all queries atomically: D1 batch, SQLite/Postgres transaction. */
  atomic(queries: Compilable[]): Promise<QueryResult<unknown>[]>;
  /** Multi-row upsert that stays within 100 bound params, via json_each(?) on SQLite and jsonb_to_recordset($1) on Postgres. */
  bulkUpsertQuery<T extends keyof Database>(table: T, rows: Insertable<Database[T]>[], opts: {
    conflict: (keyof Database[T])[]; update: (keyof Database[T])[];
    /** only overwrite when this SQL condition holds, e.g. newer client_updated_at */ whereNewer?: boolean }): Compilable[];
}
function dbFromD1(d1: D1Database): Db;
function dbFromPostgres(connectionString: string): Db;     // Hyperdrive or direct
function dbFromSqliteFile(path: string): Db;               // better-sqlite3; tests and local tools
async function migrate(db: Db): Promise<void>;             // runs migrations/*.<dialect>.sql not yet in a `migrations` table
```

- `testing/dbs.ts` exports `forEachDialect(name, fn: (makeDb: () => Promise<Db>) => void)`. It runs a suite on in-memory SQLite, and on Postgres when `TEST_DATABASE_URL` is set, using a fresh schema per suite as `kakao-list/apps/server/src/app.postgres.test.ts` does. The repo's `docker-compose.yml` provides `postgres:17` for that.
- `bulkUpsertQuery` returns one statement per chunk of 500 rows. With `whereNewer`, the update fires only when `excluded.client_updated_at > <table>.client_updated_at`.

- [ ] **Step 1: Write the failing tests** with `forEachDialect`.
  - `migrate` is idempotent: run twice, no error.
  - `atomic` rolls back every statement when one fails (a duplicate primary key in the second statement).
  - `bulkUpsertQuery` inserts 3,000 `places` rows. Every compiled statement has ≤ 100 parameters and the call produces ≤ 10 statements.
  - With `whereNewer`, a row with an older `client_updated_at` does not overwrite a newer one.

- [ ] **Step 2: Run** `pnpm --filter @magomap/db test` (and again with `TEST_DATABASE_URL` set). Expected: FAIL.
- [ ] **Step 3: Implement** the connector and migrations. `dbFromD1` uses `kysely-d1` for queries and `d1.batch()` for `atomic`.
- [ ] **Step 4: Run** the same commands. Expected: PASS on both dialects.
- [ ] **Step 5: Commit** with `feat(db): Kysely connector for D1 and Postgres with migrations`.

### Task 3: Worker skeleton, Kakao sign-in, sessions and account

**Files:**
- Create in `apps/api/`:
  - `wrangler.toml`: `compatibility_flags = ["nodejs_compat"]`; `assets = { directory = "../web/dist", not_found_handling = "single-page-application", run_worker_first = ["/api/*"] }`; `[env.d1]` with a `DB` binding; `[env.postgres]` with a `HYPERDRIVE` binding.
  - `src/index.ts`, `src/env.ts`, `src/db.ts` (picks the connector from `DB_DRIVER`, cached per isolate).
  - `src/auth/routes.ts`, `src/auth/session.ts`, `src/auth/kakao.ts`.
  - `vitest.config.ts` (workers pool, D1 binding, migrations applied in `setupFiles`).
  - `test/auth.test.ts`.
- Create `packages/db/src/stores/users.ts` and `packages/db/src/stores/users.test.ts`.

**Interfaces:**
- Stores (`users.ts`):
  - `findOrCreateUserByIdentity(db, provider, providerUserId, displayName): Promise<{ userId: string; created: boolean }>`
  - `createSession(db, userId, now): Promise<{ token: string; expiresAt: number }>`
  - `resolveSession(db, token, now): Promise<{ userId: string; refreshedExpiresAt?: number } | null>`
  - `deleteSession(db, token)`, `deleteAllSessions(db, userId)`
  - `deleteAccount(db, userId)`, which removes every row of the user in every table, atomically.
- Hono middleware `requireUser`, which sets `c.var.userId`.
- Routes:
  - `GET /api/health` returns `{ ok: true, db: "d1" | "postgres" }`, after a `SELECT 1`.
  - `GET /api/config` returns `PublicConfig`.
  - `GET /api/auth/kakao/start` sets a short-lived `mm_oauth_state` cookie and redirects to `https://kauth.kakao.com/oauth/authorize`.
  - `GET /api/auth/kakao/callback` checks the state, exchanges the code (`https://kauth.kakao.com/oauth/token`), reads the id from `https://kapi.kakao.com/v2/user/me`, applies the allowlist, then sets `mm_session` and redirects to `/`. A user not on the allowlist is redirected to `/not-invited`, and no user row is created.
  - `GET /api/me` returns `Me`.
  - `POST /api/auth/logout`, `POST /api/auth/logout-all`, `DELETE /api/account`.
  - `POST /api/auth/dev` with `{ kakaoUserId }`, mounted only when `ALLOW_DEV_LOGIN === "true"`.
  - Kakao tokens are discarded after the callback.

- [ ] **Step 1: Write the failing tests.**
  - Store tests, with `forEachDialect`:
    - the same identity twice gives the same `userId`;
    - an expired session resolves to `null`;
    - a session with less than 15 days left returns `refreshedExpiresAt`;
    - `deleteAccount` leaves zero rows for that user and keeps other users' rows.
  - Route tests (workers pool, with Kakao mocked through `fetchMock`):
    - the callback with a bad `state` gives 400;
    - a Kakao id not on the allowlist gives a 302 to `/not-invited`, and no `users` row;
    - an allowed id gives a 302 to `/` with a `Set-Cookie` containing `mm_session`, `HttpOnly`, `Secure` and `SameSite=Lax`;
    - `/api/me` without a cookie gives 401;
    - `/api/auth/dev` gives 404 unless `ALLOW_DEV_LOGIN` is set.
- [ ] **Step 2: Run** `pnpm --filter @magomap/api test` and `pnpm --filter @magomap/db test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): Kakao sign-in, sessions, allowlist and account deletion`.

### Task 4: Sync push and pull

**Files:**
- Create:
  - `packages/db/src/stores/sync.ts`, `packages/db/src/stores/sync.test.ts`;
  - `apps/api/src/sync/routes.ts`, `apps/api/test/sync.test.ts`.

**Interfaces:**
- `applyPush(db, userId, mutations: Mutation[], now: number): Promise<PushResponse>`
- `pull(db, userId, cursor: string | null, limitPerTable = 500): Promise<PullResponse>`
- Routes: `POST /api/sync/push` (body `PushRequest`), and `GET /api/sync/pull?cursor=`.

**Rules `applyPush` enforces** (each one is a test):
1. **One seq per push.** The first statement of the atomic batch is `UPDATE users SET change_seq = change_seq + 1`. Every write sets `seq = (SELECT change_seq FROM users WHERE id = ?)`.
2. **Last write wins per row**, by `clientUpdatedAt`, through `whereNewer`. A mutation that loses is reported as `ignored_stale`.
3. **Kakao data is read-only.** The server rejects (`rejected`, reason `kakao_owned`):
   - any write to a `lists` row with `kind = "kakao"`;
   - any write to a `list_items` row in a Kakao list;
   - any client attempt to create such rows.
4. **Places from the client** may only be:
   - created, with `source: "search"`, an id equal to `kakaoPlaceRowId(kakaoPlaceId)`, and lat/lng present;
   - deleted.

   An upsert on an existing place only clears `deleted_at` (restore). It never changes the Kakao fields.
5. **A visit note or link written for a deleted place restores the place.** The same batch also sets the place's `deleted_at` to null.
6. **Ownership.**
   - A `list_items` row must reference the user's own list and an existing place of the same user.
   - A visit note or link must reference an existing place of the user.
   - Anything else is `rejected` with reason `missing_parent`.
7. **Editing an imported note.** An edit to a note with `origin = "kakao_list"` sets `edited_by_user = 1`.
8. **Deletes are soft.** They set `deleted_at`, and still follow last-write-wins.
9. **Retries are safe.** Pushing the same mutation again gives the same final state, and its status is `applied` or `ignored_stale`, never an error.
10. **Statement budget.** One push of 200 mutations compiles to ≤ 50 statements: group by table and use `bulkUpsertQuery`.

**`pull`** pages each table independently with keyset `(seq, id) > (cursorSeq, cursorId)`, ordered by `seq, id`. The cursor is base64url JSON of the per-table position. Tombstones are included.

- [ ] **Step 1: Write the failing store tests** (`forEachDialect`). There is one test per rule above, plus:
  - pull with a null cursor returns everything;
  - paging with `limitPerTable = 2` over 5 places plus 3 notes returns every row exactly once and ends with `hasMore: false`;
  - after a further push, pulling from the last cursor returns only the changed rows.
- [ ] **Step 2: Write the failing route tests.**
  - 401 without a session;
  - 400 for an invalid body;
  - one round trip: a push, then a pull returns the row.
- [ ] **Step 3: Run** the db and api tests. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the tests on both dialects. Expected: PASS.
- [ ] **Step 6: Commit** with `feat: offline sync push/pull with last-write-wins and restore rules`.

### Task 5: Import from kakao-list (list by list)

The client drives the import so that no request does more than one list's work.

**Files:**
- Create:
  - `packages/db/src/stores/importRuns.ts`, `packages/db/src/stores/importRuns.test.ts`;
  - `apps/api/src/import/routes.ts`, `apps/api/test/import.test.ts`;
  - `apps/api/test/fixtures/contract.ts` (a fake kakao-list contract).
  - `apps/api/scripts/fake-kakao-list.ts`: serves the fixture on `:8788` at the kakao-list integration path, and checks the bearer secret.
  - `apps/api/scripts/dev-seed.ts`, run as `pnpm --filter @magomap/api dev:seed`. Against a local `wrangler dev`, it dev-logs in and runs a full import (source → run → lists → complete) from the fake server. The PWA plan relies on both scripts.

**Interfaces:**
- `startImportRun(db, userId, { complete: boolean; importedAt: string }, now): Promise<{ runId: string }>`

  Any earlier `running` run of that user becomes `superseded`.
- `importList(db, userId, runId, list: ImportList, now): Promise<ImportSummary>`
- `completeImportRun(db, userId, runId, kakaoFolderIds: number[], now): Promise<ImportSummary>`
- Routes:
  - `GET /api/import/kakao/source`
    - Fetches `${KAKAO_LIST_URL}/api/integrations/magomap/snapshot?kakaoUserId=<the user's kakao identity>` with `Authorization: Bearer ${MAGOMAP_IMPORT_SECRET}`.
    - **Streams the body through without parsing it.**
    - kakao-list's 404 is passed through as 404 `{ error: "no_snapshot" }`. Any other upstream failure becomes 502 `{ error: "kakao_list_unavailable" }`.
  - `POST /api/import/runs` returns `{ runId }`.
  - `PUT /api/import/runs/:runId/lists/:kakaoFolderId` takes an `ImportList` body and returns `ImportSummary`.
  - `POST /api/import/runs/:runId/complete` takes `{ kakaoFolderIds }` and returns the total `ImportSummary`.
  - `GET /api/import/runs/latest` returns the latest run's status, time and summary.

**What `importList` does, in one `atomic` batch:**
- **List.** Upsert the list `kl_<folderId>` (kind `kakao`, `subscribed`, `ownerName`, name, description). Clear `removed_from_kakao_at`.
- **Places.** For each item, upsert the place with id `kp_<placeKey>`, or `kf_<favoriteSeq>` when there is no `placeKey`.
  - Kakao fields are refreshed: title, address, category, phone, lat/lng (only when present).
  - `deleted_at` is never cleared by import. A place the user deleted stays deleted even while it is still in a Kakao list. Its membership row is still updated, and the PWA hides memberships whose place is deleted.
- **Memberships.** Upsert `ki_<folderId>_<favoriteSeq>` with `kakaoNote`, `kakaoColor` and position. Clear `removed_from_kakao_at` (counted as restored when it was set).
- **Missing memberships.** Memberships of this list that are not in the upload get `removed_from_kakao_at = now`. This happens **even when the run is not complete**, because one list's upload is the whole list.
- **Imported notes.** For each item with a `localNote`, upsert the visit note `kn_<placeId>_<folderId>`: `origin = "kakao_list"`, `origin_key = "<folderId>"`, `visited_on` null, and the body set to the note. When it already exists with `edited_by_user = 1`, leave it alone.
- **seq.** All writes bump the user's `change_seq` like a push, so devices pull them.

**What `completeImportRun` does:**
- Only when the run was started with `complete: true`, Kakao lists not in `kakaoFolderIds` get `removed_from_kakao_at`.
- It marks the run `completed` and stores the summary.

- [ ] **Step 1: Write the failing store tests** (`forEachDialect`):
  - **First import:** 2 lists, 3 places, one of them in both lists, gives 3 place rows, 4 memberships and 2 lists.
  - **Re-import** with one favourite gone: its membership is marked removed, and the place and its user visit notes are untouched.
  - **Re-import** with it back: it is restored, and `membershipsRestored === 1`.
  - **Incomplete run** (`complete: false`) that leaves out a list: completing it marks no list removed.
  - **Complete run** that leaves out a list: that list is marked removed, and its places still exist.
  - **`localNote`:** a note becomes one diary entry, and re-importing updates it. Once the note is edited with `edited_by_user = 1`, re-importing leaves it alone.
  - **Search then import:** a place created from search with `kp_123`, then imported with `placeKey: "123"`, is the same row, and its diary entries remain.
  - **Large list:** one list with 3,000 items imports within ≤ 50 statements, each with ≤ 100 parameters. Use a statement-counting `Db` wrapper.
  - **Subscribed list:** it imports with `subscribed = 1` and `owner_name` set.
- [ ] **Step 2: Write the failing route tests.**
  - `source` passes the fake kakao-list body through byte-for-byte (via `fetchMock`), and sends the bearer secret.
  - An upstream 404 gives 404 `no_snapshot`.
  - An upstream 500 gives 502.
  - A `PUT` to another user's run gives 404.
- [ ] **Step 3: Run** the tests. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the tests on both dialects. Expected: PASS.
- [ ] **Step 6: Commit** with `feat: list-by-list Kakao import from kakao-list`.

### Task 6: Place search proxy

**Files:**
- Create `apps/api/src/search/routes.ts` and `apps/api/test/search.test.ts`.
- Modify `apps/api/wrangler.toml` to add a `[[unsafe.bindings]]` ratelimit (or the GA `ratelimits` binding) named `SEARCH_LIMITER`, limited to 60 per 60 s per user.

**Interfaces:**
- `GET /api/search/places?q=&lat=&lng=&page=1` returns `{ results: SearchResult[]; isEnd: boolean }`.
- `q` must be 1–100 characters. `lat`/`lng` are optional, and when given they are sent as `y`/`x` with `sort=accuracy`.
- The upstream call is `https://dapi.kakao.com/v2/local/search/keyword.json` with header `Authorization: KakaoAK ${KAKAO_REST_API_KEY}`.
- Kakao's `id`, `place_name`, `address_name`, `road_address_name`, `category_name`, `phone`, `x` and `y` map to `SearchResult`. `x`/`y` are WGS84 longitude/latitude.

- [ ] **Step 1: Write the failing tests.**
  - The mapped fields come from a recorded Kakao response fixture.
  - An empty `q` gives 400.
  - Going over the rate limit gives 429.
  - A Kakao 401 or 5xx gives 502 `{ error: "search_unavailable" }`, and the REST key never appears in the response body.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests again. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): Kakao place search proxy`.

### Task 7: Deploy configuration and docs

**Files:**
- Create `README.md` and `.env.example` (`apps/api/.dev.vars.example`).
- Create `docs/deploy.md`.
- Modify the root `package.json` to add these scripts:
  - `db:migrate:d1` (`wrangler d1 execute` over `packages/db/migrations/*.sqlite.sql`, applying only the new ones by tracking the `migrations` table);
  - `db:migrate:postgres` (`tsx packages/db/scripts/migrate.ts`);
  - `deploy:d1`, `deploy:postgres`.

**`docs/deploy.md` covers:**
- **Choosing D1 or Postgres:**
  - for D1, create the database and set the binding id;
  - for Postgres, create the Hyperdrive config from a connection string and set its id.
- **Secrets** (`wrangler secret put`): `KAKAO_CLIENT_SECRET`, `MAGOMAP_IMPORT_SECRET`, `KAKAO_REST_API_KEY`.
- **Kakao Developers setup** in the **same app as kakao-list**:
  - add the redirect URI `https://<domain>/api/auth/kakao/callback`;
  - add the domain as a JavaScript SDK domain;
  - turn on Kakao Maps;
  - check the quota.
- **The kakao-list side:** set the same `MAGOMAP_IMPORT_SECRET` there.
- **Workers plan:** the design keeps every request within Free limits. If imports of very large lists hit the CPU limit, Workers Paid is the fix.

- [ ] **Step 1: Deploy smoke test.**
  - Locally: run `pnpm db:migrate:d1 -- --local`, then `wrangler dev --env d1`.
  - `curl /api/health` returns `{"ok":true,"db":"d1"}`.
  - Repeat with `--env postgres`, pointing Hyperdrive's `localConnectionString` at the docker Postgres. Expected: `"db":"postgres"`.
- [ ] **Step 2: Commit** with `docs: deployment for D1 or Postgres on Cloudflare`.
