# kakao-list → magomap Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `kakao-list` keep coordinates and the subscribed flag on import, record whether the latest snapshot is complete, and expose a read-only endpoint that returns a user's data in magomap's import contract.

**Architecture:** All work is in the `kakao-list` repo (`/home/motoko/workspace/kakao-list`), on a branch `feat/magomap-integration`. The extension's page extractor keeps Kakao's `x`/`y` and `subscribe`. A new domain helper converts WCONGNAMUL to WGS84. The server stamps a `complete` flag when it stores a snapshot. A new Express route maps the stored snapshot to the contract, authorised by a shared secret.

**Tech Stack:** TypeScript, Express 5, `pg`, `node:test` with `tsx`, `proj4` (new, in `@kakao-lists/domain`), pnpm workspaces, Biome.

**Spec:** `/home/motoko/workspace/magomap/docs/superpowers/specs/2026-11-19-magomap-design.md` (section "Import from Kakao").

## Global Constraints

- Dependencies must be at least 14 days old. `minimumReleaseAge: 20160` in `pnpm-workspace.yaml` enforces this; never add `proj4` to `minimumReleaseAgeExclude`.
- Use `pnpm` only, with `workspace:*` for internal packages. Lint and format with Biome (`pnpm check`, or whatever the root `package.json` defines).
- Commits use conventional commit prefixes (`feat(domain):`, `feat(server):`, `feat(extension):`), because Release Please reads them.
- The new endpoint is **read-only** and returns data for exactly one `kakaoUserId`.
- Contract field names are exactly: `contractVersion`, `kakaoUserId`, `importedAt`, `complete`, `lists[].kakaoFolderId`, `name`, `description`, `icon`, `subscribed`, `ownerName`, `items[].favoriteSeq`, `placeKey`, `title`, `address`, `category`, `phone`, `lat`, `lng`, `kakaoNote`, `kakaoColor`, `localNote`, `position`.

## Review Focus

- **A snapshot stored before this change** has no coordinates, `subscribed` or `complete`. Expect the endpoint to return `complete: false`, items without `lat`/`lng`, and `subscribed: false`. It must not crash. Tested in Task 3.
- **A list-by-list import that stops part-way** (the browser closed after chunk 2 of 5). Expect `complete: false` until a chunk carrying `expectedListIds` arrives. Tested in Task 2.
- **A wrong, missing or differently-sized secret.** Expect 401, with no timing leak (hashed constant-time compare) and nothing leaked in the body. When `MAGOMAP_IMPORT_SECRET` is unset, the route returns 404 as if it didn't exist. Tested in Task 3.
- **An unknown `kakaoUserId`** (signed into `magomap` but never imported). Expect 404 `{ error: "no_snapshot" }`, not 500. Tested in Task 3.
- **Coordinates of 0 or non-numbers from Kakao** (custom pins sometimes lack them). Expect `lat`/`lng` to be omitted, never `NaN` or a point near the projection origin. Tested in Task 1.

---

### Task 1: WCONGNAMUL → WGS84 helper

**Files:**
- Create: `packages/domain/src/coordinates.ts`
- Create: `packages/domain/src/coordinates.test.ts`
- Modify: `packages/domain/src/index.ts` (re-export), `packages/domain/package.json` (add `proj4` and `@types/proj4`)

**Interfaces:**
- Produces: `wcongnamulToLatLng(x: unknown, y: unknown): { lat: number; lng: number } | undefined`

- [ ] **Step 1: Capture three real fixtures.** Ask the owner to open `map.kakao.com` in a signed-in browser and run this in the console for three saved places, in Seoul, Busan and Jeju:

  ```js
  new kakao.maps.Coords(x, y).toLatLng()
  ```

  Use the `x`/`y` from `/favorite/mine/list`. Record each `x`, `y`, `lat` and `lng` as fixtures. If the owner isn't available, use the Kakao Local API instead: look up a place by keyword, then compare its WGS84 `x`/`y` with the favourite's WCONGNAMUL values for the same `key`.

- [ ] **Step 2: Write the failing tests.**

  ```ts
  test("converts Kakao favourite coordinates to WGS84 within ~1 m", () => {
    for (const f of FIXTURES) {
      const r = wcongnamulToLatLng(f.x, f.y)!;
      assert.ok(Math.abs(r.lat - f.lat) < 1e-5);
      assert.ok(Math.abs(r.lng - f.lng) < 1e-5);
    }
  });

  test("returns undefined for missing, zero or non-numeric coordinates", () => {
    for (const [x, y] of [[undefined, 1], [0, 0], ["a", 3], [Number.NaN, 1]]) {
      assert.equal(wcongnamulToLatLng(x, y), undefined);
    }
  });

  test("returns undefined when the result falls outside 32–40°N, 123–133°E", () => {
    assert.equal(wcongnamulToLatLng(1, 1), undefined);
  });
  ```

- [ ] **Step 3: Run** `pnpm --filter @kakao-lists/domain test`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `wcongnamulToLatLng`.**
  - Divide `x` and `y` by 2.5 to get Congnamul TM, then project with proj4.
  - Starting definition: `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +no_defs`.
  - **Adjust the definition until the fixtures pass.** The fixtures are the source of truth.
  - Reject non-finite or non-positive input. Reject results outside the Korea bounding box in the test above.

- [ ] **Step 5: Run the tests again.** Expected: PASS.

- [ ] **Step 6: Commit** with `feat(domain): convert Kakao map coordinates to latitude/longitude`.

### Task 2: Keep coordinates, subscribed flag and completeness in snapshots

**Files:**
- Modify:
  - `packages/domain/src/index.ts`
    - `FavoriteListItem`: add `lat?: number`, `lng?: number`.
    - `FavoriteList`: add `subscribed?: boolean`.
    - `SyncSnapshot`: add `complete?: boolean`.
    - `parseSnapshot`: validate the new fields (finite numbers in the Korea box; boolean).
  - `apps/extension/src/kakaoMapsExtractor.ts`
    - `KakaoMapsFolderRecord`: add `subscribe?: unknown`.
    - `normalizeFavoriteItem`: set `lat`/`lng` via `wcongnamulToLatLng(favorite.x, favorite.y)`.
    - List mapping: set `subscribed: folder.subscribe !== undefined && folder.subscribe !== null && folder.subscribe !== false`.
  - `apps/server/src/snapshots.ts`
    - `mergeSnapshotList` returns `complete: input.expectedListIds !== undefined`.
  - `apps/server/src/app.ts`
    - Whole-snapshot `PUT /api/snapshot` stores `complete: true`.
    - `PATCH /api/snapshot/item-note` keeps the existing `complete` value.
- Test:
  - `packages/domain/src/validation.test.ts`
  - `apps/server/src/snapshots.test.ts` (create if missing; pure-function tests)

**Interfaces:**
- Consumes: `wcongnamulToLatLng` (Task 1).
- Produces: `SyncSnapshot.complete`, `FavoriteList.subscribed`, `FavoriteListItem.lat`/`lng`. All are optional, so old stored snapshots still parse.

- [ ] **Step 1: Write the failing tests.**
  - `parseSnapshot` keeps `lat`/`lng`/`subscribed`/`complete` when they are valid.
  - It rejects `lat: 200` and `subscribed: "yes"`.
  - It still accepts a snapshot that has none of them.
  - `mergeSnapshotList` without `expectedListIds` gives `complete === false`.
  - `mergeSnapshotList` with `expectedListIds: ["a"]` gives `complete === true`.
  - `preserveLocalNotes(current, incoming)` keeps `incoming.complete`.

- [ ] **Step 2: Run** `pnpm --filter @kakao-lists/domain test && pnpm --filter @kakao-lists/server test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the changes listed under Files.

- [ ] **Step 4: Check against a real import.**
  - Run `pnpm --filter @kakao-lists/extension build`, load the extension unpacked, and import.
  - In the extension's stored snapshot, confirm that places have `lat`/`lng`.
  - Confirm that at least one subscribed list (if the account has one) has `subscribed: true`, and that her own lists have `false`.
  - **If `subscribe` turns out to be present on her own public lists too, stop and report** what the owner sees, rather than guessing the rule.

- [ ] **Step 5: Run** `pnpm typecheck` and both test commands. Expected: PASS.

- [ ] **Step 6: Commit** with `feat: keep coordinates, subscribed lists and import completeness`.

### Task 3: magomap integration endpoint

**Files:**
- Create: `apps/server/src/magomapIntegration.ts`
- Create: `apps/server/src/magomapIntegration.test.ts` (pure mapping)
- Modify:
  - `apps/server/src/app.ts`: mount the router.
  - `apps/server/src/app.postgres.test.ts`: route tests.
  - `.env.example` and `README.md`: add `MAGOMAP_IMPORT_SECRET`.

**Interfaces:**
- Consumes: `loadSnapshot(pool, userId)` from `snapshots.ts`.
- Produces:
  - `toMagomapContract(userId: string, stored: PushSnapshotResult): MagomapImportContract`.
  - `createMagomapIntegrationRouter(opts: { pool: Pool; secret: string }): Router`.
  - The HTTP route `GET /api/integrations/magomap/snapshot?kakaoUserId=<id>`.

  The `MagomapImportContract` type is exported from `magomapIntegration.ts`. Its shape is the one in the spec.

- [ ] **Step 1: Write the failing mapping tests** (`magomapIntegration.test.ts`).

  **Field mapping:**
  - `contractVersion === 1`, `kakaoUserId` echoes the id, `importedAt === stored.receivedAt`.
  - `complete === (stored.snapshot.complete === true)`.
  - List `id: "kakao-folder-123"` becomes `kakaoFolderId: 123`. Lists whose id doesn't match `/^kakao-folder-(\d+)$/` are skipped.
  - `subscribed` defaults to `false`.
  - `ownerName` comes from `creatorName`, and only when `subscribed` is true.
  - Item `id` becomes `favoriteSeq` (string).
  - `subtitle` becomes `address`, `color` becomes `kakaoColor`, and the array index becomes `position`.
  - `lat`/`lng`, `kakaoNote` and `localNote` pass through when present.

  **Old-snapshot case:** no `lat`/`lng`/`subscribed`/`complete` gives `complete: false` and items without coordinates.

- [ ] **Step 2: Write the failing route tests** in `app.postgres.test.ts`, with `MAGOMAP_IMPORT_SECRET: "m".repeat(48)` in `env`.
  - No `Authorization` header gives 401.
  - `Bearer wrong` gives 401.
  - A correct secret with an unknown user gives 404 with body `{ "error": "no_snapshot" }`.
  - A correct secret after a mock sign-in and a `PUT /api/snapshot` gives 200 with a contract body and `complete: true`.
  - A missing `kakaoUserId` gives 400.
  - A second app built **without** `MAGOMAP_IMPORT_SECRET` gives 404 for the route.

- [ ] **Step 3: Run** `pnpm --filter @kakao-lists/server test` (with `TEST_DATABASE_URL` set to the local docker Postgres). Expected: the new tests FAIL.

- [ ] **Step 4: Implement the router.**
  - Compare the bearer token with the same sha256 + `timingSafeEqual` pattern as `matches()` in `maintenance.ts`.
  - Reuse the server's existing per-IP rate limiter at the strictest budget used for auth routes.
  - Log each call with the user id and the response status. Never log the secret.
  - Mount the router only when `env.MAGOMAP_IMPORT_SECRET` is at least 32 characters long. When it is set but shorter, throw at startup.

- [ ] **Step 5: Run** the server tests, `pnpm typecheck` and Biome. Expected: PASS.

- [ ] **Step 6: Document.**
  - In `README.md`, under server env, add: `MAGOMAP_IMPORT_SECRET` is a shared secret (≥32 chars) that enables the read-only magomap import endpoint.
  - In `docs/architecture-decisions.md`, add a bullet: magomap pulls through this endpoint, and the contract is versioned.

- [ ] **Step 7: Commit** with `feat(server): read-only magomap import endpoint`. Open a PR against `main`; the body ends with the Claude Code attribution line.
