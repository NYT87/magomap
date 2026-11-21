# Sync from Kakao Map directly — Implementation Plan (phases 0 and 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a computer, "Sync from Kakao Map" in magomap's Account screen reads her Kakao Map lists through a new magomap browser extension and imports them, without kakao-list, while "Import from kakao-list" keeps working beside it.

**Architecture:**
- **Phase 0 (Task 0).** An owner test decides whether phone sync is possible later.
- **Extension.** A new MV3 extension (`apps/extension`) runs kakao-list's read path inside a signed-in `map.kakao.com` tab. It returns **raw** Kakao records to the magomap page through `externally_connectable`.
- **Page.** The page drives an **upload run**: a start request carrying the raw folders, then one page request per ≤ 500 raw favourites.
- **Server.**
  - The Worker maps raw records with a new adapter (`providers/kakaoMap.ts`), which matches kakao-list's mapping exactly and converts the coordinates.
  - It checks the allowlist and the user's bound Kakao Map account.
  - It reuses the existing `importRuns` store. The existing finish and complete routes serve both sources.
- **`importRuns` change.** It learns a per-user "latest snapshot" so an older import can't change roles or personal removals.

**Not in this plan:**
- **Phase 2 (phone sync)** gets its own plan, written from Task 0's results, and only if Task 0 passes.
- **Phase 3 (retiring kakao-list)** gets its own plan when the owner says both accounts are migrated.

**Order:** the lists-tab, resume-import, import-writes and account-nickname plans are merged; this plan builds on them (`apps/web/src/import/ImportSection.tsx`, `runImport.ts`, `importJob.ts`; `import_run_pages`, migration `0002`). Task 0's remaining owner steps can run any time before Task 2.

**Revised 2026-11-20** with phase 0's results (spec, "Phase 0 results"): Kakao's own `lat`/`lon` first, negative coordinates valid, zero folders means signed out, `ADDRESS` favourites are places, folder 0's id is per person, and owner ids fall back to `map_user_id`.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Kysely (D1/SQLite + Postgres), zod 4, proj4 (new), React 19 + i18next, Vitest, Chrome MV3 with Vite, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-20-kakao-direct-sync-design.md` (read it, including "Settled after the builder check"). Background: the main spec's shared-places addendum, and `kakao-list/docs/kakao-maps-private-api.md`.

## Global Constraints

- **Build process:** follow `docs/superpowers/build-process.md`. The gate is `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh`.
  - No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`.
  - Never delete or weaken tests.
- **Dependencies** must be at least 14 days old (`minimumReleaseAge: 20160`); never add exclusions. `proj4` is the only new runtime dependency. Add `@types/proj4` only if `proj4` ships no types.
- **Provider-neutral core:** Kakao field names appear only in `packages/domain/src/providers/*`, `apps/api/src/import/kakaoMapRoutes.ts` and `apps/extension`. The neutral import types (`ImportListSummary`, `ImportItem`) are unchanged.
- **Same provider, same ids:**
  - Uploads import as provider `"kakao"`.
  - List external id is `kakaoListExternalId(folderid, kakaoLoginId)` from `@magomap/domain` (`String(folderid)`, except folder 0, which is `0~<Kakao Login id>`; the Login id is the caller's `identities.provider_user_id`).
  - Item external id is `String(seq ?? key ?? "<folderid>-<index>")`.
  - Place external id is `key` only when `type` is `"PLACE"`, `"ADDRESS"` or absent.
  - The own Kakao Map account id is `kakao_map_user_id || map_user_id` of the unflagged folders.
- **Zero folders is "signed out of Kakao Map"** (phase 0): the extension answers `kakao_signed_out`, and the server refuses a start with no folders (`422 { error: "kakao_signed_out" }`), so a signed-out read can never mark lists removed.
- **Coordinates:**
  - A favourite's own `lat`/`lon` (finite numbers, inside 32–40°N, 123–133°E) are used when present.
  - Otherwise WCONGNAMUL `x`/`y` are converted. WCONGNAMUL is EPSG:5181 × 2.5. The proj4 definition is `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs`, applied to `(x / 2.5, y / 2.5)`.
  - **Negative input is valid** (southern Jeju has negative `y`). Missing, zero, non-finite or non-numeric input, and results outside 32–40°N, 123–133°E, give no coordinates, never a throw.
- **Upload `importedAt`** is the Worker's clock at run start (`new Date(now).toISOString()`), never a client value. `subscriptionKnown` is `lists.length > 0`, and `complete` is `true`.
- **Who may upload:** the caller's Kakao id is in a **non-empty** `ALLOWED_KAKAO_USER_IDS`, or `ALLOW_DEV_UPLOAD === "true"`, which is set only in the `postgres` (local) wrangler env and in tests. Otherwise the answer is `403 { error: "not_allowed" }`.
- **Never log** raw Kakao payloads, cookies or tokens.
- **Strings** exist in both `ko.json` and `en.json`. Screens work in both themes and both layouts. Touch targets are at least 44 px.
- **Database:**
  - New tables and columns get migration `0003_kakao_map.sql` in **both** `packages/db/migrations/sqlite` and `packages/db/migrations/postgres`, with statements split by `-- statement` (`0002` is the import-writes migration).
  - Code works on both dialects.
  - D1 is deployed, so `0001` and `0002` are never edited.
- **Write budget:** the import-writes budget test (`packages/db/src/stores/importWrites.test.ts`) keeps passing; an unchanged upload re-import costs no more rows than an unchanged kakao-list one.
- **Commits** use conventional prefixes and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work happens on a branch (`feat/kakao-direct-sync`) and lands by PR: `main` only takes PRs.

## Review Focus

- **The laptop is signed into the other person's Kakao Map.** Expect the sync to stop before anything is written and ask her to confirm that account. If that account is already bound to someone else, it is refused. Pinned in Tasks 4 and 5.
- **A kakao-list import, older than her last direct sync, run as the migration.** Her own lists stay `owner` and her un-followed lists stay removed. Her kakao-list local notes still arrive. Pinned in Task 3.
- **The same favourite arriving from kakao-list and from Kakao Map.** Expect one place, one membership and no duplicate pins. Pinned in Task 2's parity test and Task 5's cross-source test.
- **Kakao Map signed out, or a folder request failing part-way.** Signed out shows up as 200 with zero folders, not as an error. Expect a clear "sign in to Kakao Map" or "couldn't read" message, with nothing marked removed. Pinned in Tasks 5, 6 and 7.
- **A page with too few or too many favourites, an out-of-range page index, or an oversized body.** Expect it to be refused, the run never completed, and no removals. Pinned in Task 5.

---

### Task 0: Phase 0 — finish and record (owner gate)

Steps 1, 2 (from the owner's computer), part of 3, and the fixtures ran on 2026-11-20; their notes are in the owner's `tmp/kakao-map-access/results.md` (gitignored, no credentials). **No product code.** Throwaway scripts stay in `tmp/kakao-map-access/`.

**Files:**
- Create `docs/kakao-map-access.md`.
- Create `packages/domain/src/providers/wcongnamul.fixtures.ts`, used by Task 1.

- [x] **Step 1: Write `docs/kakao-map-access.md`** from the spec's "Phase 0 results": the token result, the one cookie and the headers, zero folders when signed out, the `folders` key, the lifetime so far, coordinates, folder 0, favourite types and owner ids. Never include a cookie, token or list contents.
- [x] **Step 2: Fixtures.** Write `export const OWNER_FIXTURES: { x: number; y: number; lat: number; lng: number }[]` into `wcongnamul.fixtures.ts` with the two pairs from phase 0 (`471350, -32433` → `33.37661909, 126.87684594`; `608064, 1159067` → `37.67127631, 127.48995646`).
- [x] **Step 3 (owner and his wife): compare one shared favourite's `seq`** as seen by her account and the owner's (both signed in to Kakao Map on the computer, one at a time, reading the same followed folder). **If the `seq`s differ, stop the plan here and tell the owner** (spec, "Settled after the builder check").
- [ ] **Step 4 (owner, optional now): phone edits.** Add a place to a list in the Kakao Map phone app; within a minute, read that folder and record whether it appears.
- [x] **Step 5: Verdict line** in `docs/kakao-map-access.md`: `Phone sync: cookie, pending the Worker read and the 7-day lifetime check` (the token route is closed). The phase 2 plan is written once those two pass.
- [ ] **Step 6: Commit** with `docs: Kakao Map access test results`.

### Task 1: WCONGNAMUL → WGS84 in magomap

**Files:**
- Create in `packages/domain/src/providers/`: `wcongnamul.ts` and `wcongnamul.test.ts` (the fixtures come from Task 0).
- Modify `packages/domain/package.json`: add `proj4`, and the export `"./providers/kakaoMap": "./src/providers/kakaoMap.ts"` used by Task 2.

**Interfaces:**
- Produces `wcongnamulToLatLng(x: unknown, y: unknown): { lat: number; lng: number } | undefined`.
- Produces `kakaoFavoritePoint(favorite: { lat?: unknown; lon?: unknown; x?: unknown; y?: unknown }): { lat: number; lng: number } | undefined`: Kakao's `lat`/`lon` when usable, else `wcongnamulToLatLng(x, y)`.

- [ ] **Step 1: Write the failing tests** in `wcongnamul.test.ts`:
  - `converts the published reference point`: `(497278, 1128228)` gives `lat ≈ 37.5611523` and `lng ≈ 126.9876757`, each within `1e-5`.
  - `matches the owner's Kakao SDK fixtures`: every `OWNER_FIXTURES` entry within `1e-5`. When the array is empty, assert `OWNER_FIXTURES.length === 0`. Never skip.
  - `keeps negative coordinates`: the Jeju fixture `(471350, -32433)` gives `33.37661909, 126.87684594` within `1e-6`.
  - `returns undefined for bad input`: `[undefined, 1]`, `[0, 0]`, `["a", 3]`, `[Number.NaN, 1]` and `[Number.POSITIVE_INFINITY, 1]`.
  - `prefers Kakao's lat/lon`: `kakaoFavoritePoint({ lat: 37.5, lon: 127.1, x: 1, y: 1 })` is `{ lat: 37.5, lng: 127.1 }`; with `lat`/`lon` missing, non-numeric or outside Korea it falls back to `x`/`y`; with neither it is `undefined`.
  - `returns undefined outside Korea`: `(5_000_000, 5_000_000)`.
- [ ] **Step 2: Run** `npx vitest run src/providers/wcongnamul.test.ts` in `packages/domain` (`pnpm … test -- <name>` doesn't filter). Expected: FAIL, with a missing module.
- [ ] **Step 3: Implement it** with proj4 and the Global Constraints definition. Build the projection once, at module level. If a Task 0 fixture is off by more than 1e-5, **stop and report**; don't change the projection. kakao-list's `packages/domain/src/coordinates.ts` (its PR #29) is the reference for the usable-input rule.
- [ ] **Step 4: Run the tests again.** Expected: PASS. Then run `pnpm --filter @magomap/api build` (or `wrangler deploy --dry-run --env d1`) to confirm proj4 bundles for Workers.
- [ ] **Step 5: Commit** with `feat(domain): convert Kakao map coordinates to latitude/longitude`. Put the proj4 docs URL in the body.

### Task 2: Raw Kakao Map adapter, identical to kakao-list's mapping

**Files:**
- Create in `packages/domain/src/providers/`: `kakaoMap.ts` and `kakaoMap.test.ts`.
- Create `packages/domain/src/providers/kakaoListParity.fixture.ts`. It holds kakao-list's mapping copied verbatim as plain functions, with a header naming the source files and commit `730ee2d` (kakao-list `main` on 2026-11-20, after its PRs #27 and #29):
  - from `apps/extension/src/kakaoMapsExtractor.ts`: `dedupeFolders`, `normalizeFavoriteItem`, the `flagged`/`ownerOf`/own-owners logic, and the list mapping;
  - from `apps/server/src/magomapIntegration.ts`: `toMagomapLists` and `toMagomapItem`, with `MAGOMAP_PLACE_TYPES = {"PLACE", "ADDRESS"}`;
  - from `packages/domain/src/coordinates.ts`: `wcongnamulToLatLng` (negative input kept).

  It feeds the result through magomap's existing `kakaoListsToImport` and `kakaoItemsToImport`, so the test compares neutral imports.

**Interfaces:**
- Consumes `kakaoFavoritePoint` (Task 1), `kakaoListExternalId` (`@magomap/domain/providers/kakao`), plus `ImportListSummary`, `ImportItem`, `importItemSchema` and `importListMetaSchema` from `@magomap/domain`.
- Produces, from `@magomap/domain/providers/kakaoMap`:

  ```ts
  /** What the extension sends at the start of an upload run. */
  export interface KakaoMapStart {
    folders: unknown[];                                    // raw /folder/list records, as received
    counts: { folderid: number; itemCount: number; firstDisplay2?: string }[];
  }
  export const kakaoMapStartSchema: z.ZodType<KakaoMapStart>;   // folders ≤ 2000 records, counts ≤ LIMITS.importLists
  export interface KakaoMapAccount { kakaoMapUserId: string; nickname?: string }
  export class KakaoAccountUnclearError extends Error {}
  export class KakaoSignedOutError extends Error {}              // zero usable folders
  /** `kakaoLoginId` is the caller's Kakao Login id, for folder 0's per-person list id. */
  export function kakaoMapListsToImport(start: KakaoMapStart, kakaoLoginId: string):
    { lists: ImportListSummary[]; account: KakaoMapAccount; subscriptionKnown: boolean };
  export function kakaoMapItemsToImport(folderid: number, offset: number, favorites: unknown[]): ImportItem[];
  ```

- [ ] **Step 1: Write the failing tests** in `kakaoMap.test.ts`. Use a raw fixture with:
  - folder 0 (own, the default list) and two own folders (user `"u1"`, one flagged public with `subscribe: "Y"`); one own folder carries only `map_user_id: 1`, no `kakao_map_user_id`;
  - one followed folder (user `"u2"`, `subscribe: "Y"`, `nickname: "Bap"`);
  - one `status: "D"` folder, and a duplicate folder record with less metadata;
  - a followed folder that comes back bare (only `folderid` and `subscribe: 1`, no title and no owner id; docs/kakao-map-access.md section 6): it is followed, never own, and keeps kakao-list's fallback name;
  - favourites of types `PLACE`, `ADDRESS` (key `N34923295`), `POINT`, `ROUTE_BICYCLE` (no `x`/`y`) and untyped;
  - one favourite with Kakao `lat`/`lon` and one with a negative `y`;
  - one favourite without `seq` and one with neither `seq` nor `key`;
  - an empty `display1`, missing `x`/`y`, and a memo longer than `LIMITS.importText`.

  The tests:
  - `parity: lists match kakao-list's mapping`: `kakaoMapListsToImport(start).lists` deep-equals the parity fixture's lists, except `itemCount`, which comes from `counts`.
  - `parity: items match kakao-list's mapping`: for each folder, `kakaoMapItemsToImport(folderid, 0, favorites)` equals the parity fixture's items on `externalId`, `placeExternalId`, `title`, `address`, `providerNote`, `providerColor` and `position`, and on `lat`/`lng` within `1e-6` (the adapter prefers Kakao's `lat`/`lon`).
  - `folder 0 is per person`: its list external id is `"0~<kakaoLoginId>"`; every other folder's is `String(folderid)`.
  - `ADDRESS is a place, routes and points are not`: the `ADDRESS` item has `placeExternalId: "N34923295"`; `POINT` and `ROUTE_BICYCLE` have none, and the route has no coordinates.
  - `zero folders throws KakaoSignedOutError`, and so does a read whose folders are all `status: "D"`.
  - `offset numbers positions and fallbacks across pages`: page 2 (`offset 500`) of a 600-item folder gives positions 500–599, the fallback title `"Saved place 501"`, and the fallback id `"<folderid>-500"`.
  - `own account`: the account is `{ kakaoMapUserId: "u1" }`, with the own folders' nickname when present. With `kakao_map_user_id` missing on every own folder, it is `String(map_user_id)` (kakao-list's `ownerOf`). The flagged own folder is not followed, and only the `u2` folder has `followed: true` and `ownerName: "Bap"`.
  - `unclear account throws`: no unflagged folders, unflagged folders with no owner id, or two different owner ids each throw `KakaoAccountUnclearError`.
  - `oversized text is cut, not rejected`: the long memo comes out at exactly `LIMITS.importText` characters, and every item passes `importItemSchema`.
  - `bad records never throw`: a folder without a numeric `folderid` is skipped. A favourite that isn't an object becomes a fallback item. No throw, except `KakaoAccountUnclearError`.
- [ ] **Step 2: Run** `npx vitest run src/providers/kakaoMap.test.ts` in `packages/domain`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Mirror the parity rules: dedupe by best metadata, skip `"D"`, `flagged()`, own owners, the description fallback to `firstDisplay2`, and `ownerName` only on followed lists from `nickname || kakao_map_user_id || "map:" + map_user_id`.
  - Before validation, cut text to the neutral limits: `importTitle` for titles and names, `importText` for addresses, notes and descriptions, 40 for colours.
  - Parse raw records leniently, with `unknown` field checks and no schema throw.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(domain): map raw Kakao Map records like kakao-list does`.

### Task 3: An older import can't change a user's roles or personal removals

**Files:**
- Create `packages/db/migrations/{sqlite,postgres}/0003_kakao_map.sql`. Task 4 appends to this same file:
  - table `user_provider_snapshots (user_id TEXT NOT NULL, provider TEXT NOT NULL, snapshot_at INTEGER|BIGINT NOT NULL, PRIMARY KEY (user_id, provider))`;
  - column `import_runs.source TEXT NOT NULL DEFAULT 'kakao_list'`.
- Modify:
  - `packages/db/src/schema.ts`: both tables' types;
  - `packages/db/src/stores/importRuns.ts`;
  - `packages/db/src/stores/users.ts`: add `user_provider_snapshots` to `USER_TABLES`.
- Test: `packages/db/src/stores/importRuns.test.ts`, on both dialects through the existing testkit.

**Interfaces:**
- `startImportRun` opts gain `source: "kakao_list" | "kakao_map"`, which is required. The existing caller in `apps/api/src/import/routes.ts` passes `"kakao_list"`.
- Produces `migratedFromKakaoList(db: Db, userId: string): Promise<boolean>`. It is true when the user has a run with `source = 'kakao_list'`, `status = 'completed'` and `complete = 1`.

- [ ] **Step 1: Write the failing tests** (all on both dialects):
  - `an older run keeps the user's owner role`: a complete owner run at T2 makes list A `owner`. A run at T1 < T2 with A `followed: true` leaves `user_lists.role === "owner"`.
  - `an older run doesn't remove lists personally`: a complete run at T2 includes the followed list F. A complete run at T1 without F leaves F's `user_lists.removed_at` null.
  - `an older run doesn't bring back a personal removal`: a run at T2 removed F for the user (`removed_at` set). A run at T1 with F leaves it removed.
  - `an older run still adds places and kakao-list notes`: the T1 run's new place appears in `user_places`, and its `localNote` becomes a `kakao_list` diary entry.
  - `an older run grants a list the user never had`: the user has no access row for list N. The T1 run creates one with the role the run says.
  - `a newer run still changes roles and removes`: the existing behaviour is unchanged for T3 > T2.
  - `snapshot time is per provider and only set by complete runs`: an incomplete run at T5 doesn't advance it.
  - `migratedFromKakaoList`: false with no runs, with a `kakao_map` run or with an incomplete kakao-list run; true after a complete kakao-list run.
- [ ] **Step 2: Run** `npx vitest run src/stores/importRuns.test.ts` in `packages/db` with `TEST_DATABASE_URL` set. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **Older run:** `snapshot_at` is below the user's `user_provider_snapshots.snapshot_at` for the run's provider.
    - In `importListChunk`, an older run writes `user_lists` only when the user has no row for that list.
    - In `completeImportRun`, an older run skips the `justMe` removals.
  - **Recording the snapshot:** `completeImportRun` upserts `user_provider_snapshots` to `max(stored, snapshot_at)` when `run.complete === 1`, in the same `withWrite` batch, guarded.
  - Store `source` on the run.
  - Shared-row rules are unchanged (since import-writes, list-level snapshots and `newestListSnapshot` decide them).
  - `importedSnapshot` (the "already imported this sync" check) counts only `source = 'kakao_list'` runs.
- [ ] **Step 4: Run** the db tests and `pnpm --filter @magomap/api test`. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(db): an older import can't change a user's roles or personal removals`.

### Task 4: Kakao Map account binding

**Files:**
- Append to both `0003_kakao_map.sql`: table `kakao_map_accounts (user_id TEXT NOT NULL PRIMARY KEY, kakao_map_user_id TEXT NOT NULL UNIQUE, nickname TEXT, bound_at INTEGER|BIGINT NOT NULL)`.
- Create `packages/db/src/stores/kakaoMapAccounts.ts` and `kakaoMapAccounts.test.ts`.
- Modify `packages/db/src/schema.ts`, and `packages/db/src/stores/users.ts` (add the table to `USER_TABLES`).

**Interfaces:**
- Produces:

  ```ts
  export class KakaoMapAccountTakenError extends Error {}
  export function boundKakaoMapAccount(db: Db, userId: string): Promise<{ kakaoMapUserId: string; nickname: string | null } | null>;
  /** Binds or re-binds the user's account; throws KakaoMapAccountTakenError if another user holds it. */
  export function bindKakaoMapAccount(db: Db, userId: string, account: { kakaoMapUserId: string; nickname?: string }, now: number): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests** (both dialects):
  - `binds and reads back`;
  - `re-binding the same user replaces the account`;
  - `another user's account is refused`, with `KakaoMapAccountTakenError`, and the existing binding unchanged;
  - `deleting the account removes the binding`, through the existing `deleteAccount`;
  - `the same user binding their own account again is a no-op`.
- [ ] **Step 2: Run** `npx vitest run src/stores/kakaoMapAccounts.test.ts` in `packages/db`. Expected: FAIL.
- [ ] **Step 3: Implement it.** It is a single statement: an upsert on `user_id` that relies on the `kakao_map_user_id` unique constraint. Map the constraint violation, on both drivers, to `KakaoMapAccountTakenError`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(db): bind a user to one Kakao Map account`.

### Task 5: Upload-run API

**Files:**
- Create `apps/api/src/import/kakaoMapRoutes.ts` and `apps/api/test/kakaoMapImport.test.ts`.
- Modify:
  - `apps/api/src/index.ts` (mount the routes);
  - `apps/api/src/env.ts` (`ALLOW_DEV_UPLOAD: string`);
  - `apps/api/wrangler.toml` (`ALLOW_DEV_UPLOAD = "false"` in `d1`, `"true"` in `postgres`);
  - `apps/api/src/import/routes.ts` (pass `source: "kakao_list"`, and add `GET /import/kakao-list/migrated`);
  - `packages/domain/src/api.ts` (error codes).

**Interfaces:**
- Consumes Task 2's adapter, Task 3's `source` and `migratedFromKakaoList`, Task 4's binding store, and the existing `startImportRun`, `runSnapshot` and `importListChunk`.
- New `ApiErrorCode` members: `"not_allowed"`, `"kakao_signed_out"`, `"kakao_account_unconfirmed"`, `"kakao_account_mismatch"`, `"kakao_account_taken"` and `"kakao_account_unclear"`.
- Routes, all behind `requireUser`:
  - `POST /api/import/kakao-map/runs`, with body `KakaoMapStart & { confirmAccount?: string }`.
    - Answers `200 { runId, lists: [{ externalId, name, itemCount }] }`, the same shape as the kakao-list start, so the web driver reuses it.
    - Or `409 { error: "kakao_account_unconfirmed" | "kakao_account_mismatch", account: { nickname?: string; idTail: string } }`, where `idTail` is the last 4 characters of `kakaoMapUserId`.
    - Or `409 { error: "kakao_account_taken" }`, `422 { error: "kakao_account_unclear" | "kakao_signed_out" }` or `403 { error: "not_allowed" }`.
  - `POST /api/import/kakao-map/runs/:runId/lists/:externalId/pages/:index`, with body `{ favorites: unknown[] }`. Answers `200 { ...ImportSummary, done: boolean }`.
  - `GET /api/import/kakao-list/migrated` answers `200 { done: boolean }`.
  - The existing `…/finish`, `…/complete` and `/import/runs/latest` serve upload runs unchanged. `/import/runs/:runId/resume` and `/import/status`'s up-to-date check stay kakao-list only (an upload run isn't resumable; spec).

- [ ] **Step 1: Write the failing tests** in `kakaoMapImport.test.ts`, using `devLogin`, `call` and raw fixtures shaped like Task 2's:
  - `refuses users outside a non-empty allowlist` (403 `not_allowed`), and `refuses everyone when the allowlist is empty and ALLOW_DEV_UPLOAD isn't "true"`.
  - `first sync asks to confirm the account`: 409 `kakao_account_unconfirmed` with `idTail`, and **no run row created**. The same body with `confirmAccount: "u1"` gives 200 and binds.
  - `a different Kakao Map account is refused until confirmed`: 409 `kakao_account_mismatch`; then, with `confirmAccount`, 200 and a re-bind.
  - `an account bound to another user is refused` (409 `kakao_account_taken`).
  - `the other person's Kakao Map, after she bound it, is refused for him`: she binds `u1`; he (a second user) starts a sync whose read is `u1` → 409 `kakao_account_taken`, no run; then his own read (`u2`) on first sync → 409 `kakao_account_unconfirmed` naming `u2`'s nickname and id tail.
  - `unclear account` gives 422, with nothing written.
  - `a signed-out read (zero folders) gives 422 kakao_signed_out`, with no run, no binding and nothing marked removed — even after an earlier complete sync of the same user.
  - `folder 0 imports as the caller's own list`: its list is `l_kakao_0%7E<login id>` (`providerListRowId`), and two users' folder 0s stay separate lists.
  - `a full upload imports lists and places`: start, every page, finish, complete. The lists, places and coordinates appear in pull. The run has `source = 'kakao_map'` and `importedAt` within 1 s of the server clock.
  - `an unchanged upload re-import stays within the write budget`: two uploads of the same raw read, the second under `countWrites`, within `10 + 6 × lists + 5 × pages` rows.
  - `pages are checked`:
    - a page whose length isn't `min(500, itemCount − index·500)` gives 400 `invalid`;
    - an index ≥ the page count gives 404;
    - a body over 1 MB gives 413;
    - `favorites` that isn't an array gives 400.

    Afterwards, `complete` gives 409 `incomplete`.
  - `the same favourite from kakao-list then Kakao Map is one place`: import the existing kakao-list fixture, then upload the raw records that kakao-list's mapping turns into that fixture (build them in the test). The place count and membership count are unchanged, and no new `kf_` pins appear.
  - `migrated is false, then true after a complete kakao-list import`.
- [ ] **Step 2: Run** `npx vitest run test/kakaoMapImport.test.ts` in `apps/api`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **Start:** allowlist → `kakaoMapStartSchema` → `kakaoMapListsToImport(start, kakaoIdentity(c))` (`KakaoSignedOutError` → 422) → the binding decision → `startImportRun({ provider: "kakao", source: "kakao_map", complete: true, subscriptionKnown, importedAt: new Date(now).toISOString(), lists })`.
  - **Binding decision:**
    - no binding and no `confirmAccount` equal to the read account → `unconfirmed`;
    - binding differs and there's no matching `confirmAccount` → `mismatch`;
    - otherwise bind, if needed, before starting the run.
  - **Page:** `runSnapshot` → the exact page size → `kakaoMapItemsToImport(kakaoFolderIdOf(externalId), index * 500, favorites)` → `importListChunk`. An external id `kakaoFolderIdOf` can't read gives 404.
  - Reject bodies over 1 MB, checking `content-length` before parsing.
  - A non-deleted folder with no `counts` entry, or a `counts` entry for an unknown folder, gives 400 `invalid`. Add a test for both to Step 1's `pages are checked` group.
- [ ] **Step 4: Run** the api tests and the gate. Expected: PASS. **Call the routes once** against `wrangler dev --env postgres` with a fixture body. Never print or log a raw read.
- [ ] **Step 5: Commit** with `feat(api): import uploads read from Kakao Map`.

### Task 6: magomap browser extension

**Files:**
- Create `apps/extension/`:
  - `package.json` (`@magomap/extension`, scripts `build`, `test`, `typecheck`, `bundle`);
  - `manifest.json`, `vite.config.ts`, `tsconfig.json`;
  - in `src/`: `background.ts`, `readInPage.ts`, `readInPage.test.ts`, `background.test.ts`;
  - `README.md` (how to load it unpacked, and the key).
- Modify `.gitignore` for the extension `dist/` and zip.

**Interfaces:**
- **Manifest:**
  - MV3, `name: "magomap"`, permissions `["scripting", "tabs"]`, host permission `["https://map.kakao.com/*"]`;
  - `externally_connectable.matches` is `["https://magomap.jmn8718.workers.dev/*", "http://localhost:5173/*", "http://localhost:8787/*"]`;
  - a `key` (public key) so the extension id is stable. Its id is recorded in `README.md` and used by Task 7.
- **Messages from the page:**
  - `{ type: "magomap.ping" }` → `{ ok: true, version: string }`.
  - `{ type: "magomap.read" }` → one of:
    - `{ ok: true, start: KakaoMapStart, favorites: Record<string, unknown[]> }`, where `favorites` is keyed by `String(folderid)` and holds every raw favourite of every non-deleted folder;
    - `{ ok: false, error: "kakao_signed_out" | "kakao_unavailable" | "busy" }`.
- `readInPage(): Promise<ReadResult>` is self-contained. It runs inside the page via `chrome.scripting.executeScript({ world: "MAIN", func: readInPage })`, so it has **no imports**.

- [ ] **Step 1: Write the failing tests:**
  - `readInPage.test.ts`, with mocked `fetch` and `window.location`:
    - `reads folders then every folder's favourites`;
    - `skips "D" folders`;
    - `builds counts with firstDisplay2`;
    - `a non-JSON or 401/403 or redirected response is kakao_signed_out`;
    - `a SUCCESS response with zero folders is kakao_signed_out` (phase 0: that is what signed out looks like);
    - `reads the "folders" key` of `/folder/list`, and keeps favourites' `lat`/`lon` unchanged;
    - `a 5xx or network failure on any folder is kakao_unavailable, with no partial result`.
  - `background.test.ts`, with a `chrome` stub:
    - `ping answers`;
    - `read uses the most recent map.kakao.com tab`;
    - `read opens a background tab when none is open and waits for it to load`;
    - `a second read while one runs answers busy`;
    - `messages from other origins are ignored`, by checking `sender.origin` against the same list as `externally_connectable`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/extension test`. Expected: FAIL.
- Because the reader runs in the `map.kakao.com` page, the browser sends the cookie and the `Referer`/`Origin` headers phase 0 found necessary; the extension sets no headers itself.
- [ ] **Step 3: Implement it.**
  - Port the fetch and parse part of kakao-list's `extractSnapshotInPageEnvelope`, with a header noting the origin. Return raw records unchanged.
  - Folder requests run at most 4 at a time.
  - Do not port note editing or place detection.
- [ ] **Step 4: Run** the tests, `pnpm --filter @magomap/extension build` and the gate. Expected: PASS. Load `dist/` unpacked in Chrome and check that `magomap.ping` answers from the local web app's console.
- [ ] **Step 5: Commit** with `feat(extension): read Kakao Map lists for magomap`. Put the Chrome `externally_connectable` and `scripting` docs URLs in the body.

### Task 7: "Sync from Kakao Map" in Account

**Files:**
- Create in `apps/web/src/import/`: `kakaoMap.ts` and `kakaoMap.test.ts`.
- Create in `apps/web/src/screens/`: `KakaoMapSyncSection.tsx` and `KakaoMapSyncSection.test.tsx`.
- Modify:
  - `apps/web/src/import/runImport.ts` and `importJob.ts`: extract the shared run loop (pages, finish, complete, the following sync); the kakao-list behaviour, including resume and the up-to-date refusal, is unchanged;
  - `apps/web/src/screens/Account.tsx`: render the new section above `ImportSection`;
  - (dropped 2026-11-21: no account needs a kakao-list migration, so `ImportSection` shows no migration status; spec, "Living with kakao-list")
  - `apps/web/src/i18n/ko.json` and `en.json`;
  - `apps/web/.env.example` and `vite-env.d.ts`: `VITE_MAGOMAP_EXTENSION_ID`;
  - `apps/web/e2e/`: a phone and desktop spec with the extension stubbed;
  - `README.md` and `docs/deploy.md`: install the extension; `ALLOW_DEV_UPLOAD`.

**Interfaces:**
- Consumes Task 5's routes and Task 6's messages.
- Produces:

  ```ts
  export type ExtensionState = "missing" | "ready";
  export function detectExtension(): Promise<ExtensionState>;             // ping with a 1.5 s timeout
  export class KakaoMapSyncError extends Error {
    constructor(readonly code: ApiErrorCode | "kakao_signed_out" | "kakao_unavailable" | "busy" | "offline" | "signed_out",
                readonly account?: { nickname?: string; idTail: string });
  }
  export function runKakaoMapSync(
    onProgress: (p: { listIndex: number; listCount: number }) => void,
    opts?: { confirmAccount?: string },
  ): Promise<ImportSummary>;
  ```

  `runKakaoMapSync` reads once through the extension. It keeps the read in memory, so the confirm-and-retry reuses it and doesn't read Kakao Map again. It then drives the start, the pages (slicing `favorites[folderid]` by 500), finish and complete, with the same single retry as `runImport`. On a `kakao_account_*` 409, it throws `KakaoMapSyncError` with `account`. Retrying with `confirmAccount` needs the full `kakaoMapUserId`: keep it from the read, and never show it beyond `idTail`.

- [ ] **Step 1: Write the failing tests:**
  - `kakaoMap.test.ts`:
    - `missing extension → "missing"`;
    - `a full sync posts start, pages of ≤500, finish, complete, then syncs`;
    - `a failed page stops before complete`;
    - `an unconfirmed account throws with idTail, and the retry sends confirmAccount without reading again`.
  - `KakaoMapSyncSection.test.tsx`:
    - `missing on desktop shows the install link`;
    - `missing on phone says it works on a computer for now`;
    - `confirm dialog names both accounts`: the Kakao Map nickname and ••••idTail, and the signed-in magomap user's name ("Sync <nickname>'s Kakao Map (••••1234) into <magomap name>'s magomap?"); Cancel writes nothing, and Sync retries;
    - `a different Kakao Map account says so`: `kakao_account_mismatch` shows "This browser is signed in to a different Kakao Map account (••••1234)" with Sign in to yours / Confirm to switch;
    - `signed out of Kakao Map shows the sign-in hint with a link to map.kakao.com`;
    - `taken / not_allowed / unclear show their messages`;
    - `progress and summary use the import strings`;
    - `offline disables the button`.
  - (No migration-status test: dropped with the migration status.)
- [ ] **Step 2: Run** `pnpm --filter @magomap/web test`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **Wording, my proposal (ko/en):**
    - title "카카오맵에서 동기화" / "Sync from Kakao Map";
    - the lead says it reads her lists from Kakao Map in this browser;
    - the confirm names both accounts: "<nickname>님의 카카오맵(••••1234)을 <magomap name>님의 magomap에 동기화할까요?" / "Sync <nickname>'s Kakao Map (••••1234) into <magomap name>'s magomap?" (spec, "Account mix-ups").
  - The install link goes to the repo's GitHub releases page, `extension-v*`.
  - The phone check reuses the layout breakpoint helper already in `layout/`.
- [ ] **Step 4: Run** the web tests, the e2e spec (ports overridable with `E2E_PORT`/`E2E_FAKE_PORT`) and the gate. Expected: PASS. Save screenshots to `tmp/review-shots/kakao-direct-sync-7/` at 390×844 and 1440×900, light and dark. Run one **real sync** on a desktop Chrome with the extension and a signed-in Kakao Map, against `wrangler dev --env postgres`.
- [ ] **Step 5: Commit** with `feat(web): sync from Kakao Map in Account`.

### Task 8: Ship (owner)

- [ ] **Step 1:** Open the PR for `feat/kakao-direct-sync`; after review the owner merges it. Release Please adds it to the next release PR; merging that runs migration `0003` on D1 and deploys (`.github/workflows/release.yml`). No hand deploy.
- [ ] **Step 2:** Release the extension zip (`pnpm --filter @magomap/extension bundle`) under its own Release Please component (`apps/extension`, tags `extension-v…`; `docs/deploy.md`, "Adding another component"). Install it on her computer.
- [ ] **Step 3:** With her, run "Sync from Kakao Map" once and confirm her account. Check that her lists and pins look right on the map, including folder 0 and a southern-Jeju place. Then run "Import from kakao-list" once (the migration) and check that her kakao-list notes arrived as diary entries and that the section says done.
- [ ] **Step 4:** Watch D1 rows written for that day (`docs/deploy.md`, "Watching D1 writes").
