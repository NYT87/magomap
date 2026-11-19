# kakao-list → magomap Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kakao-list` keeps raw Kakao coordinates, the favourite type and the subscribed flag on import, and records whether the latest snapshot is complete. It also exposes a read-only endpoint that returns a user's data in magomap's import contract, with coordinates converted to WGS84 on the server.

**Architecture:**
- All work is in the `kakao-list` repo (`/home/motoko/workspace/kakao-list`), on a branch `feat/magomap-integration`.
- The extension's page extractor runs **serialised inside the Kakao Maps page** (`chrome.scripting.executeScript({ world: "MAIN", func })`). It can't import modules, so it only copies raw fields.
- A domain helper converts WCONGNAMUL to WGS84. It is called **only on the server**, when building the contract. A projection fix therefore never needs a re-import.
- The server stamps a `complete` flag when it stores a snapshot.
- A new Express route, authorised by a shared secret, maps the stored snapshot to the contract.

**Tech Stack:** TypeScript, Express 5, `pg`, `node:test` with `tsx`, `proj4` (new, in `@kakao-lists/domain`), pnpm workspaces, Biome.

**Spec:** `/home/motoko/workspace/magomap/docs/superpowers/specs/2026-11-19-magomap-design.md` (section "Import from Kakao").

## Owner gates (need the owner and a signed-in browser; an implementer cannot do these alone)

- **G1 (before Task 1):** collect three coordinate fixtures. Do this on `map.kakao.com` while signed in.
  1. Open DevTools, then the Network tab, and find `favorite/mine/list`. Copy `x` and `y` for three saved places: one in Seoul, one in Busan, one in Jeju.
  2. For each one, run `new kakao.maps.Coords(x, y).toLatLng()` in the console and record `lat` and `lng`. The SDK is loaded on that page.
  3. Paste the results into `packages/domain/src/coordinates.fixtures.ts`.

  Until G1 is done, Task 1 uses only the published fixture below.
- **G2 (during Task 2, Step 4):** run a real import with the built extension. Record:
  - the distinct favourite `type` values, with an example place for each;
  - whether `subscribe` appears only on lists the owner follows, or on her own public lists too.

  Write the answers into `docs/kakao-maps-private-api.md`.

## Global Constraints

- Dependencies must be at least 14 days old. `minimumReleaseAge: 20160` in `pnpm-workspace.yaml` enforces this; never add `proj4` to `minimumReleaseAgeExclude`. Only add `@types/proj4` if the installed `proj4` ships no types.
- Use `pnpm` only, with `workspace:*` for internal packages, and Biome. Commits use conventional prefixes, because Release Please reads them.
- **Never throw on bad Kakao data inside `parseSnapshot`.** It runs on every stored-snapshot read, so a throw would lock the account. Invalid coordinates are dropped instead.
- The new endpoint is **read-only** and returns data for exactly one `kakaoUserId`.
- Contract field names are exactly: `contractVersion`, `kakaoUserId`, `importedAt`, `complete`, `lists[].kakaoFolderId`, `name`, `description`, `icon`, `subscribed`, `ownerName`, `items[].favoriteSeq`, `favoriteType`, `placeKey`, `title`, `address`, `category`, `phone`, `lat`, `lng`, `kakaoNote`, `kakaoColor`, `localNote`, `position`.
  - `favoriteSeq` is the stored item `id`, a stable favourite id; it is usually Kakao's `seq`.
  - `placeKey` is emitted **only for favourites whose `type` is a place type**, per G2. Other favourites have no `placeKey`, so magomap keys them as custom pins.
- WCONGNAMUL is **EPSG:5181 (GRS80, no datum shift) × 2.5**. The proj4 definition is `+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs`, applied to `(x / 2.5, y / 2.5)`.

## Review Focus

- **A snapshot stored before this change** has no raw coordinates, no `subscribed` and no `complete`. Expect `complete: false`, items without `lat`/`lng`, and `subscribed: false`. Tested in Task 3.
- **A list-by-list import that stops part-way.** Expect `complete: false` until a chunk carrying `expectedListIds` arrives. Tested in Task 2.
- **A wrong, missing or differently-sized secret.** Expect 401 with a constant-time compare. When the secret is unset, the route is absent: a plain 404 with **no** `no_snapshot` code. Tested in Task 3.
- **An unknown `kakaoUserId`.** Expect 404 with body exactly `{ "error": "no_snapshot" }`, which the global error wrapper must not rewrite. Tested in Task 3.
- **Coordinates of 0 or non-numbers.** Expect them to be dropped, never `NaN` and never a throw. Tested in Tasks 1 and 2.

---

### Task 1: WCONGNAMUL → WGS84 helper

**Files:**
- Create in `packages/domain/src/`: `coordinates.ts`, `coordinates.test.ts`, `coordinates.fixtures.ts`.
- Modify `packages/domain/src/index.ts` (re-export) and `packages/domain/package.json` (add `proj4`).

**Interfaces:**
- Produces `wcongnamulToLatLng(x: unknown, y: unknown): { lat: number; lng: number } | undefined`.

- [ ] **Step 1: Write the failing tests.**

  ```ts
  // Published pair: WGS84 (126.9876757, 37.5611523) ↔ WCONGNAMUL (497278, 1128228)
  test("converts the published reference point within ~1 m", () => {
    const r = wcongnamulToLatLng(497278, 1128228)!;
    assert.ok(Math.abs(r.lat - 37.5611523) < 1e-5);
    assert.ok(Math.abs(r.lng - 126.9876757) < 1e-5);
  });
  test("matches the owner's Kakao SDK fixtures (G1)", { skip: OWNER_FIXTURES.length === 0 }, () => { /* same tolerance */ });
  test("returns undefined for missing, zero, negative or non-numeric input", () => {
    for (const [x, y] of [[undefined, 1], [0, 0], [-5, 3], ["a", 3], [Number.NaN, 1]]) assert.equal(wcongnamulToLatLng(x, y), undefined);
  });
  test("returns undefined when the result falls outside 32–40°N, 123–133°E", () => {
    assert.equal(wcongnamulToLatLng(5_000_000, 5_000_000), undefined);
  });
  ```

- [ ] **Step 2: Run** `pnpm --filter @kakao-lists/domain test`. Expected: FAIL.
- [ ] **Step 3: Implement** it with the proj4 definition from Global Constraints.
- [ ] **Step 4: Run the tests again.** Expected: PASS. If the G1 fixtures disagree by more than 1e-5, **stop and report** rather than changing the projection.
- [ ] **Step 5: Commit** with `feat(domain): convert Kakao map coordinates to latitude/longitude`.

### Task 2: Keep raw coordinates, type, subscribed flag and completeness

**Files:**
- Modify `packages/domain/src/index.ts`:
  - `FavoriteListItem`: add `kakaoX?: number`, `kakaoY?: number`, `kakaoType?: string`.
  - `FavoriteList`: add `subscribed?: boolean`.
  - `SyncSnapshot`: add `complete?: boolean`.
  - `parseSnapshot`:
    - keep `kakaoX`/`kakaoY` only when both are finite and positive, and **drop them silently otherwise**;
    - `kakaoType`: text ≤ 40;
    - `subscribed` and `complete`: kept only when boolean, otherwise dropped.
- Modify `apps/extension/src/kakaoMapsExtractor.ts`:
  - `KakaoMapsFolderRecord`: add `subscribe?: unknown`.
  - Inside `normalizeFavoriteItem` (it runs in the page, so **no imports**), copy `kakaoX: favorite.x`, `kakaoY: favorite.y` and `kakaoType: favorite.type`.
  - The list mapping sets `subscribed` from `folder.subscribe`, using the rule G2 settles. Until G2: `subscribed: folder.subscribe != null && folder.subscribe !== false`.
- Modify `apps/server/src/snapshots.ts`:
  - `mergeSnapshotList` returns `complete: input.expectedListIds !== undefined`.
  - `preserveLocalNotes` keeps `incoming.complete`.
- Modify `apps/server/src/app.ts`:
  - `PUT /api/snapshot` stores `complete: true`, but only if the snapshot has at least one list.
  - `PATCH /api/snapshot/item-note` keeps the stored `complete`.
- Test: `packages/domain/src/validation.test.ts` and `apps/server/src/snapshots.test.ts` (create it if missing).

**Interfaces:**
- Produces the optional fields `SyncSnapshot.complete`, `FavoriteList.subscribed`, and `FavoriteListItem.kakaoX`/`kakaoY`/`kakaoType`.

- [ ] **Step 1: Write the failing tests.**
  - `parseSnapshot` keeps the valid new fields.
  - `kakaoX: -1` or `"a"` is **dropped**, not thrown, and the item survives.
  - It still accepts a snapshot that has none of the new fields.
  - `mergeSnapshotList` gives `complete === false` without `expectedListIds`, and `true` with them.
  - `preserveLocalNotes` keeps `complete`.
- [ ] **Step 2: Run** `pnpm --filter @kakao-lists/domain test && pnpm --filter @kakao-lists/server test`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes listed under Files.
- [ ] **Step 4: G2 (owner).** Build the extension, load it unpacked and import. Confirm that places carry `kakaoX`/`kakaoY`/`kakaoType`. Record the `type` values and the `subscribe` behaviour, then adjust the `subscribed` rule if G2 shows it is wrong.
- [ ] **Step 5: Run** `pnpm typecheck` and both test commands. Expected: PASS.
- [ ] **Step 6: Commit** with `feat: keep raw coordinates, favourite type, subscribed lists and import completeness`.

### Task 3: magomap integration endpoint

**Files:**
- Create `apps/server/src/magomapIntegration.ts` and `apps/server/src/magomapIntegration.test.ts`.
- Modify:
  - `apps/server/src/app.ts`: mount the router, and exempt `request.path.startsWith("/api/integrations/")` from the global error-body wrapper at lines 109–148;
  - `apps/server/src/app.postgres.test.ts`;
  - `.env.example`, `README.md`, `docs/architecture-decisions.md`.

**Interfaces:**
- Consumes `loadSnapshot(pool, userId)` and `wcongnamulToLatLng`.
- Produces:
  - `toMagomapContract(userId: string, stored: PushSnapshotResult, placeTypes: ReadonlySet<string>): MagomapImportContract`. `placeTypes` comes from G2.
  - `createMagomapIntegrationRouter(opts: { pool: Pool; secret: string }): Router`.
  - The route `GET /api/integrations/magomap/snapshot?kakaoUserId=<id>`.

- [ ] **Step 1: Write the failing mapping tests.**
  - `contractVersion === 1`, and `importedAt === stored.receivedAt`.
  - `complete === (snapshot.complete === true)`.
  - The list id `kakao-folder-123` becomes `kakaoFolderId: 123`, and lists with a non-matching id are skipped.
  - `subscribed` defaults to false. `ownerName` comes from `creatorName`, and only when the list is subscribed.
  - Item `id` becomes `favoriteSeq`, `kakaoType` becomes `favoriteType`, `subtitle` becomes `address`, and `color` becomes `kakaoColor`. `position` is the array index.
  - `kakaoX`/`kakaoY` are converted to `lat`/`lng`. When the conversion gives `undefined`, `lat`/`lng` are omitted.
  - `placeKey` is emitted only when `kakaoType ∈ placeTypes`, **or** when `kakaoType` is missing (older snapshots).
  - `kakaoNote` and `localNote` pass through.
  - An old snapshot with none of the new fields gives `complete: false` and no coordinates.
- [ ] **Step 2: Write the failing route tests**, with `MAGOMAP_IMPORT_SECRET: "m".repeat(48)`.
  - A request with no header gives 401, and so does `Bearer wrong`.
  - A known secret with an unknown user gives 404 with a JSON body **exactly** `{"error":"no_snapshot"}`.
  - After a mock sign-in and `PUT /api/snapshot`, the endpoint gives 200 and `complete: true`.
  - A missing `kakaoUserId` gives 400.
  - An app without the secret gives 404 for this path, without `no_snapshot`.
  - An app with a 10-character secret starts normally, logs a warning, and returns the same plain 404.
- [ ] **Step 3: Run** `pnpm --filter @kakao-lists/server test` with `TEST_DATABASE_URL` set. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Compare the secret with sha256 + `timingSafeEqual`, as `matches()` in `maintenance.ts` does.
  - Use the existing strictest per-IP limiter.
  - Log the user id and status, and never the secret.
  - Mount the router only when the secret is at least 32 characters.
- [ ] **Step 5: Run** the server tests, `pnpm typecheck` and Biome. Expected: PASS.
- [ ] **Step 6: Document.**
  - README and `.env.example`: `MAGOMAP_IMPORT_SECRET` (at least 32 characters) enables the read-only magomap endpoint.
  - `docs/architecture-decisions.md`: magomap pulls through a versioned contract, and coordinates are converted on the server.
- [ ] **Step 7: Commit** with `feat(server): read-only magomap import endpoint`. Open a PR against `main`; its body ends with the Claude Code attribution line.
