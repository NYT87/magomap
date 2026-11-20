# Import writes only what changed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** Re-importing lists that didn't change writes a handful of rows per list and per page, never a few rows per place. Getting a new list, or signing up again, no longer rewrites every shared row of that list.

**Architecture:**
- **Today's cost.** On 2026-11-19 and 2026-11-20, production D1 wrote 90k and 123k rows, against a free limit of 100k a day. Almost all of it came from imports (Cloudflare D1 query analytics, last 30 h):

  | Statement | Rows written | Cause |
  |---|---|---|
  | `update place_sources set seq … where place_id IN (SELECT place_id FROM list_items …)` | 79k | `grantStatements` re-stamps a whole list when a user gains it |
  | `update list_items set provider_snapshot_at …` | 71k | the "touch" of every unchanged item on every new snapshot (`importRuns.ts:588-596`) |
  | `update list_items set seq … where list_id IN …` | 53k | `grantStatements` again |
  | `INSERT INTO places … SELECT json_each` | 89k | new or changed places; Task 1 checks that unchanged ones never get here |
  | `import_seen` insert, then delete at completion | 2 rows per item, every import | `importRuns.ts:577` and `:766` |

- **What changes.** Four things:
  1. **Measure in tests.** `Db.atomic` reports the rows each statement changed, so tests can set a write budget.
  2. **No per-row touch.** Only the list row records the newest snapshot. A place's "newest snapshot" is read as the newest of its own and of the lists that hold it.
  3. **Per-page seen ids.** The items seen are kept as one row per page instead of one row per item.
  4. **Grants without re-stamping.** A grant writes only the user's own access row. The device that receives a new access row pulls everything again once (reads only).

**Tech Stack:** TypeScript, Kysely on D1 (SQLite) and Postgres, Vitest (`forEachDialect` runs every db test on both), Dexie on the client.

**Spec:** the owner's request of 2026-11-20 after the Cloudflare "91% of the daily D1 free tier rows_written" email: "write the plan for the fix". The goal is to stay on the free plan, including once direct Kakao sync (`docs/superpowers/specs/2026-11-20-kakao-direct-sync-design.md`) imports several times a day. The numbers above are from the D1 analytics API on 2026-11-20.

**Not tied to kakao-list.** The kakao-list import is temporary, but everything here lives in the shared `importRuns` store and the sync layer. The direct Kakao Map sync reuses that store unchanged (its spec, "Upload runs"; its plan, `importRuns` is reused for start, chunk, finish and complete). Nothing in this plan touches the kakao-list routes. Build this before direct sync: that plan's `importRuns` task (per-user latest snapshot) then lands on the cheaper code, rather than the two editing `decideChunk` at the same time.

## Global Constraints

- **Behaviour stays the same.** Every existing test in `packages/db/src/stores/importRuns.test.ts`, `importIntegrity.test.ts`, `sharedReview.test.ts`, `pull.test.ts` and `sync.test.ts` keeps passing unchanged, except the one Task 4 names (it is replaced by an equivalent end-to-end assertion, never just deleted).
- **Newest snapshot wins for shared data:**
  - an older snapshot never changes a shared list, membership or place that a newer snapshot wrote or confirmed;
  - it may still grant the user access and create their own notes (`importRuns.ts:344, 401-404`).
- **Write budget.** Re-importing unchanged data with a newer snapshot changes at most `10 + 6 × lists + 5 × pages` rows in total, counted by `numAffectedRows`. Pages are counted per list, at 500 items per page (`LIMITS.importChunkItems`). The budget does not grow with the number of items.
- **Production data:** new migrations are new files (`0002_…sql`) in both `packages/db/migrations/sqlite/` and `packages/db/migrations/postgres/`. `0001_init.sql` is never edited again.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Protected paths:** `scripts/`, `biome.json`, `tsconfig.base.json`, `.github/**`, `.claude/agents/**`, and `docs/superpowers/**` except this plan.
- **Commits:** on branch `fix/import-writes`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The S1 < S2 < S3 case:**
   - setup: a place changed at S1; it was confirmed unchanged at S3, and no row was touched;
   - then another user imports the same list at S2 with different data;
   - expected: the place and the membership keep the S1 data that S3 confirmed.

   Test in Task 2.
2. **A run in flight across the deploy:** an import that started before the Task 3 migration can't finish against the dropped `import_seen` table. It must end as superseded, and the user starts again. It must never mark items removed. (Task 3.)
3. **A new follower of an old list:** after Task 4, the follower's phone gets every item and place of a list that was imported long ago. It gets them through the single full re-pull, not through re-stamped rows. (Task 4, a client test and a db test.)
4. **A first sign-in on a new device does not pull twice.** The re-pull happens only when the pull started from a stored cursor. (Task 4.)
5. **An unchanged re-import of a place with every column set changes zero `places` rows**, including address, road address, phone, category and a moved location. A `same()` mismatch would silently rewrite every place on every import. (Task 1.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Write counts and budget test | code |
| 2 No per-row touch | code |
| 3 Seen ids per page | code, security |
| 4 Grants without re-stamping | code, ux |

---

### Task 1: Count the rows each write changes, and pin the budget

**Files:**
- Modify:
  - `packages/db/src/core.ts` (the `Db.atomic` doc comment);
  - `packages/db/src/d1.ts:12-19`;
  - `packages/db/src/sqlite.ts`;
  - `packages/db/src/postgres.ts:36-38`.
- Create: `packages/db/src/testing/countWrites.ts`
- Test: `packages/db/src/stores/importWrites.test.ts` (create)

**Interfaces:**
- **Produces:** every `QueryResult` that `atomic` returns carries `numAffectedRows: bigint`, as follows:
  - D1: `BigInt(r.meta?.changes ?? 0)`;
  - SQLite (the test connector): the driver's `changes`;
  - Postgres: Kysely's own `numAffectedRows`, or `0n` when that is undefined.
- **Produces:** `countWrites(db: Db): { db: Db; written(): number; reset(): void }` in `countWrites.ts`. It wraps `atomic` and sums `numAffectedRows` across calls.

- [ ] **Step 1: Write the failing tests** in `importWrites.test.ts`, inside `forEachDialect`, reusing the `importRuns.test.ts` helpers. Copy what's needed; don't export test helpers from production code.
  - **`an unchanged re-import with a newer snapshot stays within the write budget`:**
    - setup: lists "1" (600 items, so 2 pages) and "2" (3 items, 1 page), imported at snapshot 0;
    - action: re-import the same data at snapshot 1000, counted with `countWrites`;
    - expect: `written() <= 10 + 6 * 2 + 5 * 3`.
  - **`an unchanged re-import changes no places, list items or sources`:**
    - setup: one item whose place sets title, address, category, phone, lat and lng, imported at snapshot 0;
    - action: re-import it identically at snapshot 1000;
    - expect: `all(db, "places")`, `"list_items"` and `"place_sources"` are deep-equal to the rows before the re-import, every column included.
  - **`atomic reports the rows each statement changed`:** a two-statement `atomic` (an insert of 3 rows, then an update of 1) returns `numAffectedRows` `3n` and `1n`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/db test -- importWrites`. Expected: the budget test and the "no places" test FAIL (today's touch and `import_seen` rows), and the `atomic` test FAILs (no `numAffectedRows`).
- [ ] **Step 3: Implement** the connector change and `countWrites`.
  - If the "changes no places" test still fails after Task 2's touch removal would make it pass, a `same()` mismatch is rewriting places. Fix it in `importRuns.ts` in Task 2 and note it there.
  - Don't make the budget test pass in this task. Commit it failing **only** if the gate allows that; otherwise mark the two expected-to-fail tests with `it.fails(` and the comment `gate-allow: passes after Task 2/3 of the import-writes plan`. Task 3 turns them into plain `it(`.
- [ ] **Step 4: Run** `pnpm --filter @magomap/db test`. The `atomic` test passes; the full suite is otherwise unchanged.
- [ ] **Step 5: Commit** `test(db): count rows written per write and pin the import write budget`

### Task 2: Unchanged rows keep their snapshot; the list carries the newest one

**Files:**
- Modify: `packages/db/src/stores/importRuns.ts` (`decideChunk`, lines 286-605)
- Test: `packages/db/src/stores/importRuns.test.ts` (add), `importWrites.test.ts`

**Interfaces:**
- **Produces:** `async function newestListSnapshot(db: Db, placeIds: string[]): Promise<Map<string, number>>` in `importRuns.ts`.
  - Returns each place's newest `lists.provider_snapshot_at`, over the lists whose `list_items` hold it with `removed_at_provider IS NULL`.
  - It is one read, using `inJson` on `list_items.place_id`, joined to `lists`, `GROUP BY place_id`.

- [ ] **Step 1: Write the failing test** `keeps a place and membership an older snapshot would change after a newer one confirmed them` (in `importRuns.test.ts`, `forEachDialect`):
  1. WIFE imports list "1" with `item("10", "A", { lat: NORTH(500), providerNote: "new" })` at snapshot 100.
  2. WIFE re-imports exactly that at snapshot 3000.
  3. ME imports list "1" (`followed: true`) with `item("10", "A", { lat: NORTH(0), providerNote: "old" })` at snapshot 2000.
  4. Expect place A's lat `toBeCloseTo(NORTH(500), 6)`, `i_kakao_1_10.provider_note === "new"`, and no `place_locations` rows.
- [ ] **Step 2: Run** `pnpm --filter @magomap/db test -- importRuns`. It should PASS today (the touch protects it): this pins the behaviour before the touch goes.
- [ ] **Step 3: Implement.**
  - Remove the `touch.places` and `touch.list_items` pushes, and their statements. Keep `touch.lists`: one row per list, which is how a list records the newest snapshot.
  - When deciding a place with `isNewer(snapshotAt, existing)`, compare against `max(existing.provider_snapshot_at, newestListSnapshot.get(placeId))`.
  - Memberships already use the list-level `listIsCurrent`; leave their `isNewer(snapshotAt, member)` check as it is.
  - `finishImportList`'s `notSeen` condition stays unchanged.
- [ ] **Step 4: Run** `pnpm --filter @magomap/db test`. Everything passes, including the Step 1 test and "ignores an older snapshot for shared data". Turn Task 1's "changes no places" test from `it.fails(` into `it(`: it passes now. If it doesn't, find and fix the `same()` mismatch, and write the column that differs into the commit body. The budget test stays `it.fails(` until Task 3.
- [ ] **Step 5: Commit** `fix(db): an unchanged import leaves places and list items alone`

### Task 3: Seen items are kept per page, not per item

**Files:**
- Create: `packages/db/migrations/sqlite/0002_import_run_pages.sql`, `packages/db/migrations/postgres/0002_import_run_pages.sql`
- Modify:
  - `packages/db/src/schema.ts` and `packages/db/src/columnTypes.ts` (the new table; remove `import_seen`);
  - `packages/db/src/stores/importRuns.ts` (lines 577-601, 629, 765-769);
  - `packages/db/src/stores/users.ts`, if account deletion deletes `import_seen`.
- Test: `importRuns.test.ts`, `importWrites.test.ts`

**Interfaces:**
- **Produces:** table `import_run_pages`:
  - columns `user_id TEXT NOT NULL`, `run_id TEXT NOT NULL`, `external_id TEXT NOT NULL`, `page INTEGER NOT NULL`, `item_ids TEXT NOT NULL` (a JSON array of `list_items.id`);
  - primary key `(user_id, run_id, external_id, page)`.
- **The migration, in this order:**
  1. `UPDATE import_runs SET status = 'superseded', finished_at = <now in ms> WHERE status = 'running'`. A run in flight can't finish without its seen rows. On SQLite use `CAST(strftime('%s','now') AS INTEGER) * 1000`; on Postgres use `(EXTRACT(EPOCH FROM now()) * 1000)::bigint`.
  2. `DELETE FROM import_run_lists`.
  3. `DROP TABLE import_seen`.
  4. `CREATE TABLE import_run_pages`.

  Use the same `-- statement` separators as `0001_init.sql`.

- [ ] **Step 1: Write the failing tests:**
  - **`a page retried with the same items is seen once`:** send page 0 twice, then finish. The list's items are not marked removed, and `import_run_pages` holds one row for that page.
  - **`a run started before the migration ends as superseded and marks nothing removed`:** apply `0001` and a running run with an `import_seen` row, apply `0002`, then expect the run's status `superseded` and every `list_items.removed_at_provider` still null. Use the migration runner in `packages/db/src/migrate.ts`, or the helpers in `src/testing/dbs.ts`, whichever applies migration files in order.
  - Task 1's tests marked `it.fails(` become `it(` and pass.
- [ ] **Step 2: Run** `pnpm --filter @magomap/db test -- importRuns importWrites`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `decideChunk` upserts one `import_run_pages` row per chunk (conflict on its key, `item_ids` updated).
  - `finishImportList`'s `notSeen` becomes `id NOT IN (SELECT value FROM json_each(p.item_ids) …)` over that run's and list's pages. On Postgres it becomes `SELECT jsonb_array_elements_text(p.item_ids::jsonb) …`. Branch on `db.dialect`, the way `bulkUpsertQuery` does.
  - `completeImportRun` deletes the run's `import_run_pages` rows instead of `import_seen`.
  - `startImportRun`'s cleanup of superseded runs also deletes their pages.
- [ ] **Step 4: Run** `pnpm --filter @magomap/db test`, then `pnpm db:migrate:d1 --local` from a copy of an existing local D1 state (`apps/api/.wrangler`). Expected: all pass, and the migration applies cleanly on top of `0001`.
- [ ] **Step 5: Commit** `fix(db): keep seen items per page, not one row per item`

### Task 4: A new list or place is delivered by one re-pull, not by re-stamping shared rows

**Files:**
- Modify:
  - `packages/db/src/write.ts` (`grantStatements`, lines 112-178);
  - `packages/db/src/stores/importRuns.ts` (lines 331, 398, 504, 510-511, 587);
  - `apps/web/src/data/sync.ts` (`pullAll`, lines 195-222);
  - `docs/deploy.md` (a short "Watching D1 writes" note).
- Test:
  - `packages/db/src/stores/importRuns.test.ts`: replace "delivers a list someone imported long ago to a new follower", see Step 1;
  - `apps/web/src/data/sync.test.ts`, or the existing pull test file next to `sync.ts`.

**Interfaces:**
- **Server.** `grantStatements` keeps only the re-stamp for places other users need: an existing place that gains a membership in a list someone already has (line 510). Rename that input `sharedPlaceIds`. Gaining access (`grantLists`, and the new `user_places` at line 504) writes only the user's own `user_lists` and `user_places` row.
- **Client.** `pullAll(db)` records whether it started from a stored cursor. While applying pages, it notes any `user_lists` or `user_places` row whose id wasn't in Dexie before. A `user_lists` row whose `removed_at` went from set to null also counts. If the pull started from a cursor and such a row arrived, then after the last page it deletes `meta.cursor` and pulls again once (no loop). The return value is the total pulled.

- [ ] **Step 1: Write the failing tests:**
  - **db, replacing the named test:** `a new follower of a list imported long ago gets it in a full pull, and nothing shared is re-stamped`.
    - setup: the same as the old test;
    - expect: `pull(db, ME, null)` contains the same ids the old test listed;
    - expect: comparing all `lists`, `list_items`, `places` and `place_sources` before and after ME's import shows every `seq` unchanged.
  - **client:** `pulls everything again once when a new list arrives`.
    - setup: mock `/api/sync/pull` with an existing cursor; the first response carries a new `user_lists` row;
    - expect: a second request goes out without a cursor, and there is no third.
  - **client:** `a first pull on a new device does not pull twice` (no stored cursor).
- [ ] **Step 2: Run** `pnpm --filter @magomap/db test -- importRuns` and `pnpm --filter @magomap/web test -- sync`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. In `docs/deploy.md`, add a "Watching D1 writes" note: the free limit is 100,000 rows a day, and Cloudflare emails at 90%. Name the dashboard place (D1 → magomap → Metrics). Say that one unchanged import should now cost a few hundred rows.
- [ ] **Step 4: Run** both suites, then `./scripts/gate.sh <task base>` → `GATE: PASS`. Run `pnpm --filter @magomap/web e2e -- import` if the import e2e works on main by then. It was broken on main on 2026-11-20 for an unrelated reason; say which in the report.
- [ ] **Step 5: Commit** `fix: deliver a new list by one re-pull instead of re-stamping shared rows`
