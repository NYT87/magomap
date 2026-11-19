# magomap Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker API for magomap. It covers Kakao sign-in, offline sync (push/pull), location history, the Kakao import from `kakao-list`, and Kakao place search. It runs on D1 or Postgres behind one database connector.

**Architecture:** This is a pnpm monorepo in `/home/motoko/workspace/magomap`.
- `packages/domain` holds the wire types, zod schemas, id helpers and the location rule, shared with the PWA.
- `packages/db` holds:
  - the Kysely schema and the per-dialect migrations;
  - the `Db` connector, split into separate entry points so the Worker never bundles native or filesystem code;
  - every data-access "store". All logic that touches the database lives here, so the same tests run on SQLite and Postgres.
- `apps/api` is a thin Hono Worker that parses requests and calls stores.

**Tech Stack:** TypeScript (strict), Hono, Kysely, `kysely-d1`, `pg` ≥ 8.16.3 (Kysely `PostgresDialect`, through Hyperdrive with `nodejs_compat`), `better-sqlite3` (tests and CLI only), zod, `uuid` (v7), Vitest 4 with `@cloudflare/vitest-plugin`, MSW with `@msw/cloudflare` for outbound mocks, Wrangler ≥ 4.36, Biome.

**Spec:** `/home/motoko/workspace/magomap/docs/superpowers/specs/2026-11-19-magomap-design.md`, including its addenda.

**Depends on:** nothing to start. The import builds against a fake `kakao-list` server (Task 5), and goes live once plan 01 is deployed.

## Global Constraints

**Tooling**
- `pnpm-workspace.yaml` has `minimumReleaseAge: 20160` (14 days). Biome is configured at the root. Node 22.

**Scoping**
- **Every query is scoped by `user_id`.** Every store function takes `userId`.

**Ids**
- All helpers live in `@magomap/domain/ids`, and no task builds an id by hand.
- Places:
  - `kp_<placeKey>`: Kakao places, the same id from search, import or any device;
  - `kf_<favoriteSeq>`: custom pins.
- Lists:
  - `kl_<kakaoFolderId>`: Kakao lists;
  - a UUIDv7 for own lists.
- Memberships:
  - `ki_<kakaoFolderId>_<favoriteSeq>`: Kakao memberships;
  - `li_<listId>_<placeId>`: own-list memberships, so two devices adding the same place collapse into one row.
- Diary entries:
  - `kn_<placeId>_<kakaoFolderId>`: imported notes;
  - a UUIDv7 for other notes and links.
- Primary keys are `(user_id, id)`.

**Storage**
- Timestamps are integer epoch ms: `BIGINT` on Postgres, with `pg`'s int8 parser set to `Number`. Lat/lng are `DOUBLE PRECISION` on Postgres and `REAL` on SQLite. Booleans are 0/1 integers. `visited_on` is `YYYY-MM-DD` text.

**D1 and Workers limits**
- At most 100 bound parameters per statement.
- No interactive transactions. Use `Db.atomic`: a D1 batch, or a transaction elsewhere.
- Every bound JSON parameter is at most **1 MB of serialised bytes**. D1's string limit is 2 MB.
- Workers Free allows about 10 ms of CPU, so a request handles at most one 500-item import chunk or one push.

**Limits**
- Diary body ≤ 20,000 characters.
- Link URL ≤ 2,048, `http(s)` only. Link title ≤ 300.
- List name ≤ 100.
- Push ≤ 200 mutations **and** ≤ 1 MB body.
- Pull page ≤ 500 rows per table.
- Import items: title ≤ 1,000; address, `kakaoNote` and `localNote` ≤ 5,000; an import chunk ≤ 500 items; a list ≤ 5,000 items in total.

**Location rule** (`isLocationMove`, `@magomap/domain/location`)
- When both sides have coordinates, it is a move only if the distance is **more than 30 m** (haversine). The address is ignored.
- Only when either side lacks coordinates, compare `address`, and only if both values come from the same source (`address_source`: `kakao_import` | `search`).
- A null or absent incoming field never counts as a change and never overwrites a value.
- Null → value is a silent fill, never a move.
- Only the server writes `place_locations`.

**Sessions**
- Cookie `mm_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`, lasting 30 days and sliding when less than 15 days remain. Only the SHA-256 hash of the token is stored.

**Postgres connections**
- Postgres `Db` objects are created **per request** and closed in `ctx.waitUntil`. Only the D1 `Db` may be cached per isolate.
- The Hyperdrive config is created with **`--caching-disabled`**.

**Environment**
- `DB_DRIVER` (`d1` | `postgres`).
- `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`, `KAKAO_JAVASCRIPT_KEY`.
- `ALLOWED_KAKAO_USER_IDS` (comma-separated; empty means open).
- `KAKAO_LIST_URL`, `MAGOMAP_IMPORT_SECRET`.
- `ALLOW_DEV_LOGIN` (`true` only locally).
- Wrangler doesn't inherit `vars` or bindings into environments, so every var and binding is declared under both `[env.d1]` and `[env.postgres]`.
- The Kakao app is the **same Kakao Developers app** as kakao-list.

**Testing**
- Postgres tests run against the repo's `docker-compose.yml` (`postgres:17`).
- In CI, `TEST_DATABASE_URL` is required: `forEachDialect` **fails**, not skips, when `CI` is set and the variable is missing.

## Review Focus

- **Offline "create, then edit, then delete" of one note pushed in one batch.** Expect one final state and no Postgres "cannot affect row a second time" error. Tested in Task 4.
- **A place saved from search plus a note on it, pushed together.** Expect both to be applied, with no `missing_parent`. Tested in Task 4.
- **One invalid mutation in a push.** Expect only that mutation to be `rejected: invalid`, and the rest applied. Tested in Task 4.
- **The same unmoved place seen through search, then import, then search.** Expect zero `place_locations` rows. Tested in Tasks 1 and 5.
- **An import that stops part-way, or a 3,000-item list.** Expect nothing to be marked removed until the list and the run are finalised; every statement stays within the parameter and byte limits. Tested in Task 5.

---

### Task 1: Monorepo, domain wire types, ids and the location rule

**Files:**
- Create at the root:
  - `package.json` (scripts `build`, `test`, `typecheck`, `check`);
  - `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc` (`22`);
  - `docker-compose.yml` (`postgres:17` on 5432).
- Create in `packages/domain/src/`:
  - `rows.ts`, `sync.ts`, `importContract.ts`, `api.ts`, `ids.ts`, `location.ts`, `index.ts`;
  - `sync.test.ts`, `location.test.ts`.
- Subpath exports: `@magomap/domain`, `/ids`, `/location`.

**Interfaces (Produces, used by every later task and by plan 03):**

```ts
// rows.ts
type SyncTable = "places" | "lists" | "list_items" | "visit_notes" | "links" | "place_locations";
type ClientWritableTable = Exclude<SyncTable, "place_locations">;
interface Base { id: string; createdAt: number; updatedAt: number; deletedAt: number | null; seq?: number }
interface PlaceRow extends Base { kakaoPlaceId: string | null; title: string; address: string | null; roadAddress: string | null;
  addressSource: "kakao_import" | "search" | null; category: string | null; phone: string | null; lat: number | null; lng: number | null; source: "kakao_import" | "search" }
interface ListRow extends Base { kind: "kakao" | "own"; kakaoFolderId: number | null; subscribed: boolean; ownerName: string | null;
  name: string; description: string | null; color: string | null; removedFromKakaoAt: number | null }
interface ListItemRow extends Base { listId: string; placeId: string; position: number; addedAt: number;
  kakaoFavoriteSeq: string | null; kakaoNote: string | null; kakaoColor: string | null; removedFromKakaoAt: number | null }
interface VisitNoteRow extends Base { placeId: string; visitedOn: string | null; body: string;
  origin: "user" | "kakao_list"; originKey: string | null; editedByUser: boolean }
interface LinkRow extends Base { placeId: string; url: string; title: string | null }
interface PlaceLocationRow extends Base { placeId: string; address: string | null; roadAddress: string | null;
  lat: number | null; lng: number | null; validFrom: number; validUntil: number; detectedBy: "kakao_import" | "search" }
type AnyRow = PlaceRow | ListRow | ListItemRow | VisitNoteRow | LinkRow | PlaceLocationRow;

// sync.ts
interface Mutation { mutationId: string; table: ClientWritableTable; op: "upsert" | "delete"; id: string; row?: unknown; clientUpdatedAt: number }
type MutationStatus = "applied" | "ignored_stale" | "rejected";
type RejectReason = "invalid" | "kakao_owned" | "server_owned" | "missing_parent" | "not_allowed";
interface PushRequest { mutations: Mutation[] }    // envelope: 1..200 items, ≤ 1 MB; items are validated one by one
interface PushResult { mutationId: string; status: MutationStatus; reason?: RejectReason; row?: AnyRow } // row: current server row for ignored_stale
interface PushResponse { results: PushResult[] }
interface PullResponse { rows: { table: SyncTable; row: AnyRow }[]; cursor: string; hasMore: boolean }
const pushEnvelopeSchema: ZodType;                       // shape only: array length, mutationId/table/op/id/clientUpdatedAt types
const mutationRowSchemas: Record<ClientWritableTable, ZodType>;  // per-row validation, applied per mutation

// importContract.ts
interface MagomapImportContract { contractVersion: 1; kakaoUserId: string; importedAt: string; complete: boolean; lists: ImportList[] }
interface ImportList { kakaoFolderId: number; name: string; description?: string; icon?: string; subscribed: boolean; ownerName?: string; items: ImportItem[] }
interface ImportItem { favoriteSeq: string; favoriteType?: string; placeKey?: string; title: string; address?: string; category?: string; phone?: string;
  lat?: number; lng?: number; kakaoNote?: string; kakaoColor?: string; localNote?: string; position: number }
const importContractSchema: ZodType<MagomapImportContract>;   // limits from Global Constraints; lists ≤ 500, items per list ≤ 5000
const importListMetaSchema: ZodType<Omit<ImportList, "items">>;
const importItemsChunkSchema: ZodType<ImportItem[]>;          // ≤ 500
interface ImportSummary { listsAdded: number; listsUpdated: number; listsRemoved: number; placesAdded: number; placesMoved: number;
  membershipsRemoved: number; membershipsRestored: number; notesImported: number }

// api.ts
interface Me { userId: string; displayName: string | null; identities: { provider: "kakao" | "google" }[] }
interface PublicConfig { kakaoJavascriptKey: string | null; devLoginEnabled: boolean }
interface SearchResult { kakaoPlaceId: string; title: string; address: string | null; roadAddress: string | null;
  category: string | null; phone: string | null; lat: number; lng: number }
interface ImportRunInfo { runId: string; status: "running" | "completed" | "failed" | "superseded"; startedAt: number; finishedAt: number | null; summary: ImportSummary | null }
type ApiErrorCode = "no_snapshot" | "kakao_list_unavailable" | "search_unavailable" | "rate_limited" | "run_closed";

// ids.ts
function newId(): string;                                         // UUIDv7
function kakaoPlaceRowId(placeKey: string): string;               // "kp_<key>"
function customPinRowId(favoriteSeq: string): string;             // "kf_<seq>"
function kakaoListRowId(folderId: number): string;                // "kl_<id>"
function kakaoMembershipRowId(folderId: number, favoriteSeq: string): string; // "ki_<f>_<s>"
function ownMembershipRowId(listId: string, placeId: string): string;          // "li_<l>_<p>"
function importedNoteRowId(placeId: string, folderId: number): string;         // "kn_<p>_<f>"

// location.ts
type LocationFields = { lat: number | null; lng: number | null; address: string | null; roadAddress: string | null; addressSource: "kakao_import" | "search" | null };
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
function isLocationMove(current: LocationFields, incoming: Partial<LocationFields>): boolean;
function mergeLocation(current: LocationFields, incoming: Partial<LocationFields>): LocationFields; // nulls never overwrite
```

- [ ] **Step 1: Write the failing tests.**
  - **Push envelope (`sync.test.ts`):**
    - `pushEnvelopeSchema` rejects 0 and 201 mutations, and rejects `table: "place_locations"`.
  - **Row schemas:**
    - the `links` row schema rejects `javascript:alert(1)`;
    - the `visit_notes` row schema rejects `visitedOn: "2026-13-01"`.
  - **Ids:**
    - every helper's output matches its pattern;
    - `newId()` is 36 characters with version digit `7`.
  - **Location rule (`location.test.ts`):**
    - a 10 m shift is not a move, and a 50 m shift is;
    - the same coordinates with a different address is **not** a move;
    - a current with no coordinates and a different address of the same `addressSource` is a move;
    - a different `addressSource` is not a move;
    - null → coordinates is not a move;
    - an incoming `lat: undefined` is not a move;
    - `mergeLocation` never replaces a value with null.
- [ ] **Step 2: Run** `pnpm -r test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm -r test && pnpm typecheck && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(domain): wire types, ids, validation and location rule`.

### Task 2: Database connector, schema and migrations

**Files:**
- Create in `packages/db/`:
  - `migrations/sqlite/0001_init.sql` and `migrations/postgres/0001_init.sql`;
  - `src/schema.ts` and `src/columnTypes.ts`;
  - `src/core.ts` (the `Db` type and the dialect-neutral `bulkUpsertQuery` builder);
  - one entry point per connector: `src/d1.ts`, `src/postgres.ts`, `src/sqlite.ts`;
  - `src/migrate.ts` and `scripts/migrate.ts`;
  - `src/testing/dbs.ts` and `src/connector.test.ts`.
- `package.json` exports:
  - `@magomap/db` (core and stores, with no driver imports);
  - `@magomap/db/d1`, `@magomap/db/postgres`, `@magomap/db/sqlite`, `@magomap/db/migrate`.
- **The Worker imports only `@magomap/db`, `/d1` and `/postgres`.**

**Tables:**
- The spec's data model, plus `places.address_source`.
- `place_locations` with an index on `(user_id, place_id)`.
- Every syncable table has `client_updated_at` and `seq`, with an index on `(user_id, seq, id)`.
- `users(id, display_name, change_seq, created_at)`.
- `identities(user_id, provider, provider_user_id, created_at)`, unique on `(provider, provider_user_id)`.
- `sessions(token_hash PK, user_id, expires_at, created_at)`.
- `import_runs(user_id, id, started_at, finished_at, status, complete, summary_json, error)`.
- `import_seen(user_id, run_id, list_item_id)`, primary key over all three columns. The import uses it to know which memberships a run has seen.

**Interfaces:**

```ts
// core.ts
interface Db {
  kysely: Kysely<Database>;
  dialect: "sqlite" | "postgres";
  atomic(queries: Compilable[]): Promise<QueryResult<unknown>[]>;  // all-or-nothing
  close(): Promise<void>;                                           // no-op for D1
}
function bulkUpsertQuery<T extends keyof Database>(db: Db, table: T, rows: Insertable<Database[T]>[], opts: {
  conflict: (keyof Database[T] & string)[];
  /** columns set from the incoming row on conflict */ update: (keyof Database[T] & string)[];
  /** raw SQL per column overriding `update`, e.g. { lat: sql`coalesce(excluded.lat, places.lat)` } */ updateExpr?: Partial<Record<keyof Database[T] & string, RawBuilder<unknown>>>;
  /** extra condition on the DO UPDATE, e.g. sql`visit_notes.edited_by_user = 0` */ where?: RawBuilder<boolean>;
  /** shorthand for where excluded.client_updated_at > <table>.client_updated_at */ whereNewer?: boolean;
}): Compilable[];
// columnTypes.ts — runtime map used by the Postgres jsonb_to_recordset column list
const COLUMN_TYPES: { [T in keyof Database]: Record<keyof Database[T] & string, "text" | "bigint" | "integer" | "double precision"> };

// d1.ts / postgres.ts / sqlite.ts
function dbFromD1(d1: D1Database): Db;                  // kysely-d1; atomic = d1.batch()
function dbFromPostgres(connectionString: string): Db;  // pg Pool max 1; int8 parser → Number; atomic = BEGIN/COMMIT on one client
function dbFromSqliteFile(path: string): Db;            // better-sqlite3; atomic = transaction
// migrate.ts (Node only)
async function migrate(db: Db, dir: string): Promise<string[]>;  // applies <dir>/*.sql not in `_migrations`, statements split on lines that are exactly `-- statement`
```

**How `bulkUpsertQuery` builds statements:**
- One statement per chunk. A chunk is at most 500 rows **and** at most 1 MB of JSON.
- SQLite: `INSERT INTO t (cols) SELECT … FROM json_each(?) WHERE true ON CONFLICT (…) DO UPDATE SET … [WHERE …]`. The `WHERE true` is required by SQLite's `INSERT … SELECT` upsert syntax.
- Postgres: `INSERT INTO t (cols) SELECT … FROM jsonb_to_recordset($1::jsonb) AS r(<COLUMN_TYPES>) ON CONFLICT … DO UPDATE …`.

**Test databases:**
- `testing/dbs.ts` exports `forEachDialect(name, fn: (makeDb: () => Promise<Db>) => void)`. It runs `fn` on in-memory SQLite (via `migrate` with `migrations/sqlite`), and on Postgres when `TEST_DATABASE_URL` is set, with a fresh schema per suite. It throws when `CI` is set and `TEST_DATABASE_URL` is not.

- [ ] **Step 1: Write the failing tests** (`forEachDialect`):
  - `migrate` twice applies nothing the second time.
  - `atomic` rolls back everything when the second statement violates the primary key.
  - `bulkUpsertQuery` with 3,000 places produces only statements with ≤ 100 parameters, each JSON parameter ≤ 1 MB.
  - With 200 notes of 20,000 Korean characters, it splits by bytes.
  - With `whereNewer`, an older `client_updated_at` doesn't overwrite.
  - `updateExpr` with `coalesce` keeps the existing `lat` when the incoming one is null.
  - Postgres returns `seq` and timestamps as `number`.
- [ ] **Step 2: Run** `docker compose up -d postgres`, then `pnpm --filter @magomap/db test` with and without `TEST_DATABASE_URL`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS on both dialects.
- [ ] **Step 5: Commit** with `feat(db): Kysely connector for D1 and Postgres with migrations`.

### Task 3: Worker skeleton, Kakao sign-in, sessions and account

**Files:**
- Create in `apps/api/`:
  - `wrangler.toml`:
    - `name = "magomap"`, `main = "src/index.ts"`, a `compatibility_date` of at least 14 days ago, and `compatibility_flags = ["nodejs_compat"]`;
    - `[env.d1]`: `vars.DB_DRIVER = "d1"`, a `[[env.d1.d1_databases]]` binding `DB` with `migrations_dir = "../../packages/db/migrations/sqlite"`, and the other vars;
    - `[env.postgres]`: `vars.DB_DRIVER = "postgres"`, a `[[env.postgres.hyperdrive]]` binding `HYPERDRIVE` (with `localConnectionString` for dev), and the other vars.
    - **No `assets` block yet.** Plan 03 Task 1 adds it.
  - `src/index.ts` and `src/env.ts`;
  - `src/db.ts`:
    - `getDb(c)`: for D1, built once per isolate and cached; for Postgres, built per request, with `c.executionCtx.waitUntil(db.close())`;
    - imports `@magomap/db/d1` and `@magomap/db/postgres` only.
  - `src/auth/routes.ts`, `src/auth/session.ts`, `src/auth/kakao.ts`;
  - `vitest.config.ts`: `@cloudflare/vitest-plugin`, D1 binding, and a setup that calls `applyD1Migrations(env.DB, await readD1Migrations(dir))`;
  - `test/msw.ts` (`@msw/cloudflare` server for outbound mocks) and `test/auth.test.ts`.
- Create `packages/db/src/stores/users.ts` and `packages/db/src/stores/users.test.ts`.

**Interfaces:**
- Stores:
  - `findOrCreateUserByIdentity(db, provider, providerUserId, displayName): Promise<{ userId: string; created: boolean }>`
  - `createSession(db, userId, now): Promise<{ token: string; expiresAt: number }>`
  - `resolveSession(db, token, now): Promise<{ userId: string; refreshedExpiresAt?: number } | null>`
  - `deleteSession(db, token)`, `deleteAllSessions(db, userId)`
  - `deleteAccount(db, userId)`, which removes the user's rows from every table, atomically.
- Hono middleware `requireUser`, which sets `c.var.userId`.
- Routes:
  - `GET /api/health` returns `{ ok: true, db: "d1" | "postgres" }`, after a `SELECT 1`.
  - `GET /api/config` returns `PublicConfig`.
  - `GET /api/auth/kakao/start` sets an `mm_oauth_state` cookie (10 min) and redirects to `https://kauth.kakao.com/oauth/authorize`.
  - `GET /api/auth/kakao/callback`:
    - checks the state, exchanges the code at `https://kauth.kakao.com/oauth/token`, and reads the id from `https://kapi.kakao.com/v2/user/me`;
    - applies the allowlist: a user not on it is redirected to `/not-invited`, and no rows are created;
    - otherwise it sets `mm_session` and redirects to `/`;
    - Kakao tokens are discarded.
  - `GET /api/me` returns `Me`.
  - `POST /api/auth/logout`, `POST /api/auth/logout-all`, `DELETE /api/account`.
  - `POST /api/auth/dev` with `{ kakaoUserId }`, only when `ALLOW_DEV_LOGIN === "true"`.

- [ ] **Step 1: Write the failing tests.**
  - Store tests (`forEachDialect`):
    - the same identity gives the same user;
    - an expired session gives `null`;
    - a session with less than 15 days left returns `refreshedExpiresAt`;
    - `deleteAccount` removes only that user's rows.
  - Route tests (MSW for Kakao):
    - a bad `state` gives 400;
    - a user not on the allowlist gives a 302 to `/not-invited` and no user row;
    - an allowed user gives a 302 to `/` with `mm_session`, `HttpOnly`, `Secure` and `SameSite=Lax`;
    - `/api/me` without a cookie gives 401;
    - `/api/auth/dev` gives 404 unless it is enabled;
    - `/api/config.devLoginEnabled` reflects `ALLOW_DEV_LOGIN`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/api test && pnpm --filter @magomap/db test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): Kakao sign-in, sessions, allowlist and account deletion`.

### Task 4: Sync push and pull, with location history from search

**Files:**
- Create `packages/db/src/stores/sync.ts` and `packages/db/src/stores/sync.test.ts`.
- Create `apps/api/src/sync/routes.ts` and `apps/api/test/sync.test.ts`.

**Interfaces:**
- `applyPush(db, userId, mutations: Mutation[], now: number): Promise<PushResponse>`
- `pull(db, userId, cursor: string | null, limitPerTable = 500): Promise<PullResponse>`
- `applyLocationUpdate(current: PlaceRow, incoming: Partial<LocationFields>, detectedBy, now, previousValidUntil: number | null): { place: PlaceRow; history?: PlaceLocationRow; changed: boolean }`
  - This is a pure function, also used by Task 5.
  - `history.validFrom` is `previousValidUntil`, or the place's `createdAt` when that is null.
- Routes:
  - `POST /api/sync/push`: 400 only when the envelope is malformed; 413 when the body is over 1 MB.
  - `GET /api/sync/pull?cursor=`.

**`applyPush` algorithm.** Each step is a test.
1. **Validate each mutation** with `mutationRowSchemas[table]`. Failures become `rejected: invalid`, and the rest continue.
2. **Coalesce.** Keep only the last mutation per `(table, id)` in push order. The earlier ones are reported `applied`. This prevents Postgres "cannot affect row a second time".
3. **Pre-read** in one query per table: the existing rows for every id in the push, plus the parent places and lists they reference, plus the latest `place_locations.valid_until` for affected places.
4. **Parents** are the existing rows plus rows upserted earlier in the same push. Apply in the order places → lists → list_items → visit_notes/links.
5. **Kakao-owned rows** are rejected with `kakao_owned`: any write to `lists` of kind `kakao`, or to `list_items` in a Kakao list.
6. **Membership ids.** `list_items` must use `ownMembershipRowId(listId, placeId)`, reference the user's own list, and reference an existing or same-push place. Otherwise `rejected: missing_parent` or `not_allowed`.
7. **Places from the client:**
   - a create needs `source: "search"`, an id equal to `kakaoPlaceRowId(kakaoPlaceId)`, and lat/lng;
   - a delete is a tombstone on the place row only;
   - an upsert of an existing place: clears `deleted_at`; never changes title or category; applies location fields through `applyLocationUpdate(..., "search")`, which may add a `place_locations` row.
8. **A visit note or link upserted for a deleted place** restores the place in the same batch. This happens only when that upsert is applied; deletes and stale mutations never restore.
9. **Last write wins** per row, by `clientUpdatedAt`, using `whereNewer`. A loser is reported `ignored_stale` and **carries the current server `row`**.
10. **Imported notes.** An upsert or delete of an `origin = "kakao_list"` note sets `edited_by_user = 1`, so a later import leaves it alone.
11. **One batch.** The first statement is `UPDATE users SET change_seq = change_seq + 1`, and every write sets `seq = (SELECT change_seq …)`. Writes go through `bulkUpsertQuery`, so a 200-mutation push stays a single `atomic` batch.
12. **Retries are safe.** Pushing the same mutations again gives the same final state, with statuses `applied` or `ignored_stale`.

**`pull`:**
- Each of the 6 tables is paged on its own, with keyset `(seq, id) > cursor[table]`, ordered by `seq, id`.
- The cursor is base64url JSON. Tombstones are included.

- [ ] **Step 1: Write the failing store tests** (`forEachDialect`).
  - There is one test per algorithm step, plus:
    - **create, edit and delete of one note in one push** gives one tombstoned row on both dialects;
    - **a searched place plus a note on it in one push** applies both;
    - **one invalid link among 3 mutations** gives 1 `rejected: invalid` and 2 `applied`;
    - **a stale edit** returns the server row;
    - **a search upsert 100 m away** gives one `place_locations` row with `detectedBy: "search"`;
    - **a search upsert 10 m away**, or with only a different address, gives no row;
    - **a membership pushed twice from two "devices"** gives one row.
  - Pull:
    - a null cursor returns everything;
    - with `limitPerTable = 2` over 5 places and 3 notes, every row comes back exactly once and the last page has `hasMore: false`;
    - after another push, only the changed rows come back.
- [ ] **Step 2: Write the failing route tests.**
  - 401 without a session.
  - 400 for a malformed envelope.
  - 413 for a body over 1 MB.
  - A push followed by a pull round-trips.
- [ ] **Step 3: Run** the db and api tests. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the tests on both dialects. Expected: PASS.
- [ ] **Step 6: Commit** with `feat: offline sync push/pull with coalescing, parent ordering and location history`.

### Task 5: Import from kakao-list (list by list, in chunks)

**Files:**
- Create `packages/db/src/stores/importRuns.ts` and `packages/db/src/stores/importRuns.test.ts`.
- Create `apps/api/src/import/routes.ts` and `apps/api/test/import.test.ts`.
- Create in `apps/api/test/fixtures/`: `contract.ts` (base fixture) and `contractVariants.ts` (`withoutFavourite(seq)`, `incomplete()`, `moved(seq, meters)`).
- Create the dev scripts in `apps/api/scripts/`:
  - `fake-kakao-list.ts`:
    - serves the fixture on `:8788` at `/api/integrations/magomap/snapshot`, checking the bearer secret;
    - `POST /__variant` with `{ name, args }` switches the variant;
    - an unknown user gives 404 `{"error":"no_snapshot"}`.
  - `dev-seed.ts`, run as `pnpm --filter @magomap/api dev:seed`: dev-login against a local `wrangler dev`, then run a full import.

**Interfaces:**
- Stores:
  - `startImportRun(db, userId, { complete, importedAt }, now): Promise<{ runId: string }>`. Any earlier `running` run becomes `superseded`.
  - `importListChunk(db, userId, runId, meta: Omit<ImportList, "items">, items: ImportItem[], now): Promise<ImportSummary>`
  - `finishImportList(db, userId, runId, kakaoFolderId, now): Promise<ImportSummary>`
  - `completeImportRun(db, userId, runId, kakaoFolderIds: number[], now): Promise<ImportSummary>`
  - `latestImportRun(db, userId): Promise<ImportRunInfo | null>`
  - A write to a run that is not `running` throws `RunClosedError`, which becomes 409 `run_closed`.
- Routes:
  - `GET /api/import/kakao/source`:
    - fetches `${KAKAO_LIST_URL}/api/integrations/magomap/snapshot?kakaoUserId=<kakao identity>` with `Authorization: Bearer ${MAGOMAP_IMPORT_SECRET}`;
    - **streams a 200 body through without parsing**;
    - passes an upstream 404 **with** body `{"error":"no_snapshot"}` through as 404 `no_snapshot`;
    - turns any other non-200 status into 502 `kakao_list_unavailable`.
  - `POST /api/import/runs` returns `{ runId }`.
  - `PUT /api/import/runs/:runId/lists/:kakaoFolderId/chunks/:index` takes `{ meta, items }` (≤ 500 items).
  - `POST /api/import/runs/:runId/lists/:kakaoFolderId/finish`.
  - `POST /api/import/runs/:runId/complete` takes `{ kakaoFolderIds }`.
  - `GET /api/import/runs/latest` returns `ImportRunInfo | null`.

**What `importListChunk` does** (one `atomic` batch; changed rows only get a new `seq`):
- **Pre-read.** One `SELECT` of the existing places for the chunk's place ids, using `json_each(?)` or `jsonb_array_elements_text`, plus their latest `place_locations.valid_until`.
- **List.** Upsert `kakaoListRowId` with kind `kakao`, `subscribed`, `ownerName`, name and description. Clear `removed_from_kakao_at`.
- **Places.** The id is `kakaoPlaceRowId(placeKey)`, or `customPinRowId(favoriteSeq)` when there is no `placeKey`.
  - New places are inserted with `source: "kakao_import"`, `address_source: "kakao_import"` and `client_updated_at: 0`.
  - Existing places get their title, category and phone refreshed when present, and location changes go through `applyLocationUpdate(..., "kakao_import")`.
  - The import **never changes `client_updated_at` or `deleted_at`**, so a place the user deleted stays deleted.
  - `seq` is bumped only when a value actually changed.
- **Memberships.** Upsert `kakaoMembershipRowId` with the Kakao note, colour and position. Clear `removed_from_kakao_at` (counted as restored when it was set). Insert the membership into `import_seen`.
- **Imported notes.** For each `localNote`, upsert `importedNoteRowId(placeId, folderId)`:
  - `origin: "kakao_list"`, `origin_key` set to the folder id, `visited_on: null`, `client_updated_at: 0`;
  - **skipped** when the row exists with `edited_by_user = 1` or `deleted_at` set.

**What `finishImportList` does:** memberships of that list that are **not** in `import_seen` for this run get `removed_from_kakao_at = now`.

**What `completeImportRun` does:**
- When the run has `complete: true` **and** at least one list was finished, Kakao lists not in `kakaoFolderIds` get `removed_from_kakao_at`.
- It clears this run's `import_seen` rows, and marks the run `completed` with its summary.

- [ ] **Step 1: Write the failing store tests** (`forEachDialect`):
  - **First import:** 2 lists, 3 places, one of them in both lists, gives 3 places, 4 memberships and 2 lists.
  - **A list split across 2 chunks:** nothing is marked removed until `finishImportList`.
  - **A favourite removed:** after finish, its membership is marked removed, and the place and its notes are untouched. When it comes back, it is restored.
  - **`complete: false`, a missing list, then complete:** no list is marked removed.
  - **`complete: true` with zero lists finished:** no list is marked removed.
  - **`complete: true` with a missing list:** that list is marked removed, and its places remain.
  - **Local notes:**
    - `localNote` becomes one note, and a re-import updates it;
    - a note marked `edited_by_user` is untouched;
    - a deleted imported note is not resurrected.
  - **Search then import:** a place from search with `kp_123`, then imported with `placeKey "123"` and the same coordinates, is the same row, its notes remain, and there are **0** `place_locations` rows.
  - **Moves:**
    - a 200 m move gives one row with `detectedBy: "kakao_import"`;
    - a 5 m change gives none;
    - two moves chain `validFrom`/`validUntil`.
  - **Re-importing unchanged data** bumps no `seq` (a pull from the previous cursor returns nothing).
  - **A 3,000-item list** in six 500-item chunks: every statement has ≤ 100 parameters and its JSON is ≤ 1 MB.
  - **A write to a superseded run** throws `RunClosedError`.
- [ ] **Step 2: Write the failing route tests** (MSW):
  - `source` passes the body through byte-for-byte, with the bearer secret.
  - An upstream 404 with `no_snapshot` gives 404 `no_snapshot`.
  - An upstream 404 without it, or a 500, gives 502.
  - A `PUT` to another user's run gives 404.
  - A chunk of 501 items gives 400.
- [ ] **Step 3: Run** the tests. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the tests on both dialects. Expected: PASS.
- [ ] **Step 6: Commit** with `feat: chunked Kakao import from kakao-list with location history`.

### Task 6: Place search proxy

**Files:**
- Create `apps/api/src/search/routes.ts` and `apps/api/test/search.test.ts`.
- Modify `apps/api/wrangler.toml`: under **both** environments, add `[[env.<e>.ratelimits]]` with `name = "SEARCH_LIMITER"`, a `namespace_id`, and `simple = { limit = 60, period = 60 }`.

**Interfaces:**
- `GET /api/search/places?q=&lat=&lng=&page=1` returns `{ results: SearchResult[]; isEnd: boolean }`.
  - `q` must be 1–100 characters.
  - When `lat`/`lng` are given, send `x=lng`, `y=lat`, `radius=20000` and `sort=accuracy`.
  - The upstream call is `https://dapi.kakao.com/v2/local/search/keyword.json` with `Authorization: KakaoAK ${KAKAO_REST_API_KEY}`.
  - The rate limiter is keyed by `userId`.
- Mapping: `id`, `place_name`, `address_name`, `road_address_name`, `category_name`, `phone`, `x` and `y` become `SearchResult`. `x`/`y` are WGS84 longitude/latitude.

- [ ] **Step 1: Write the failing tests** (MSW).
  - The mapping is checked against a recorded fixture.
  - An empty `q` gives 400.
  - Going over the limit gives 429 `rate_limited`.
  - A Kakao 401 or 5xx gives 502 `search_unavailable`, and the key never appears in the body.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests again. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): Kakao place search proxy`.

### Task 7: Deploy configuration, CI and docs

**Files:**
- Create `README.md` and `apps/api/.dev.vars.example`.
- Create `docs/deploy.md` and `.github/workflows/ci.yml`.
- Modify the root `package.json` to add these scripts:
  - `db:migrate:d1`: `wrangler d1 migrations apply DB --env d1`, which takes `--local` or `--remote`;
  - `db:migrate:postgres`: `tsx packages/db/scripts/migrate.ts postgres`;
  - `deploy:d1` and `deploy:postgres`.

**`ci.yml`:**
- Runs `pnpm test`, `pnpm typecheck` and `pnpm check`.
- Has a `postgres:17` service, with `TEST_DATABASE_URL` set.
- Actions are pinned to the commit SHA of releases at least 14 days old.

**`docs/deploy.md`:**
- Choose D1 or Postgres.
  - For D1, create the database and bind its id.
  - For Postgres, run `wrangler hyperdrive create … --caching-disabled` and bind its id.
- Set the secrets (`KAKAO_CLIENT_SECRET`, `MAGOMAP_IMPORT_SECRET`, `KAKAO_REST_API_KEY`), and create the rate-limit namespace.
- Kakao Developers setup in the **same app as kakao-list**: add the redirect URI `https://<domain>/api/auth/kakao/callback` and the JavaScript SDK domain, turn on Kakao Maps, and check the quota.
- Set the same `MAGOMAP_IMPORT_SECRET` on kakao-list.
- On Workers plans: the design keeps every request within Free limits.

- [ ] **Step 1: Smoke-test D1 locally.** Run `pnpm db:migrate:d1 --local`, then `wrangler dev --env d1`. Expected: `curl /api/health` returns `{"ok":true,"db":"d1"}`.
- [ ] **Step 2: Smoke-test Postgres locally.** Run `pnpm db:migrate:postgres`, then `wrangler dev --env postgres` against the compose Postgres. Expected: `"db":"postgres"`, and a push followed by an immediate pull returns the new row, which shows reads aren't stale.
- [ ] **Step 3: Commit** with `docs: deployment for D1 or Postgres on Cloudflare, CI with Postgres`.
