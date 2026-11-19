# Shared, Provider-Neutral Places and Lists: Backend Rework Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the plan 01 backend so places and provider lists are stored once and shared, the core is provider-neutral, and Kakao is an adapter. Everything plan 01 guarantees still holds: nothing is lost, writes are concurrency-safe, both dialects behave the same, and requests fit the D1 limits.

**Architecture:**
- Shared tables (`places`, `place_sources`, `place_locations`, `lists`, `list_items`) have no `user_id`.
- Per-user tables (`user_lists`, `user_places`, `visit_notes`, `links`, `tombstones`) keep `(user_id, id)`.
- One **global** write check (`sync_state` row: `change_seq`, `write_token`) replaces the per-user one. Every write claims it, and every synced row gets that seq. For a personal app, serializing all writes is cheap and makes cross-user decisions safe.
- Pull returns per-user rows, plus shared rows in the user's scope.
- When a user gains access, the import re-stamps the seq of the shared rows they now have, so the normal pull delivers them.

**Tech Stack:** unchanged from plan 01.

**Spec:** `docs/superpowers/specs/2026-11-19-magomap-design.md`, addendum "shared places and shared Kakao lists", including "Settled after the builder check".

**Order:** this runs after plan 01 and before plan 02. Plan 02 and plan 03 are updated in Task 6.

**Build process:** `docs/superpowers/build-process.md`. The gate runs on every task. The final review runs code, security and Codex.

## Global Constraints

**Naming**
- No `kakao` in domain, db or API core names. Kakao code lives only in:
  - `packages/domain/src/providers/kakao.ts` (contract mapping and ids);
  - `apps/api/src/search/` and `apps/api/src/auth/kakao.ts`;
  - `apps/api/src/import/routes.ts`, where the source URL points at kakao-list.
- The neutral provider name for Kakao is `"kakao"`.

**Ids** (all helpers live in `@magomap/domain/ids`)

| Row | Id |
|---|---|
| place | `placeRowId(provider, externalId)` = `p_<provider>_<externalId>` |
| custom pin | `pinRowId(provider, listExternalId, itemExternalId)` = `pin_<provider>_<listExternalId>_<itemExternalId>` |
| provider list | `providerListRowId(provider, externalId)` = `l_<provider>_<externalId>` |
| provider item | `providerItemRowId(provider, listExternalId, itemExternalId)` = `i_<provider>_<l>_<i>` |
| own list | UUIDv7 |
| own item | `ownItemRowId(listId, placeId)` = `li_<listId>_<placeId>` |
| user_lists | `userListRowId(listId)` = `ul_<listId>` |
| user_places | `userPlaceRowId(placeId)` = `up_<placeId>` |
| imported note | `importedNoteRowId(placeId, listId)` = `kn_<placeId>_<listId>` |

**Sync tables**
- `places`, `place_sources`, `place_locations`, `lists`, `list_items`, `user_lists`, `user_places`, `visit_notes`, `links`.
- Client-writable: `places` (create from search, location refresh), `lists` (own), `list_items` (own), `visit_notes`, `links`.

**Places are never deleted.** A push `delete` on `places` is rejected with `not_allowed`.

**Newer snapshot wins.** Shared rows written by imports carry `provider_snapshot_at` (ms). An import whose `importedAt` is older than a row's value leaves that row unchanged.

**Limits.** All plan 01 limits still apply: ≤ 100 params per statement, ≤ 1 MB per JSON parameter, ≤ 50 statements per request.

**Testing.** Everything is tested on both dialects (`forEachDialect`), and the gate passes on every task.

## Review Focus

- **The husband imports his wife's list first, then she imports it.** Expect one list, one set of items and one place per Kakao place. Expect each user's `user_lists` role to be correct (follower, owner) and each user's notes to stay private.
- **An old snapshot imported after a newer one.** Expect no shared field to change and no history row added.
- **A user unfollows a list.** Expect `user_lists.removed_at` set for them only; the list and its items leave their pull, and stay for the other user.
- **A user gains a list someone imported long ago.** Expect their next pull from their cursor to include the list, its items, its places and their sources and history.
- **A user pushes an own list or item whose id belongs to another user's list.** Expect `not_allowed`, with nothing changed.

---

### Task 1: Domain — neutral types, ids, contract, Kakao adapter

**Files:**
- Modify `packages/domain/src/rows.ts`, `ids.ts`, `sync.ts`, `importContract.ts`, `api.ts`.
- Create `packages/domain/src/providers/kakao.ts` and `packages/domain/src/providers/kakao.test.ts`.
- Modify `packages/domain/src/sync.test.ts`.

**Interfaces:**

```ts
// rows.ts
type SyncTable = "places" | "place_sources" | "place_locations" | "lists" | "list_items" | "user_lists" | "user_places" | "visit_notes" | "links";
type ClientWritableTable = "places" | "lists" | "list_items" | "visit_notes" | "links";
interface PlaceRow extends Base { title; address; roadAddress; addressSource: "import" | "search" | null; category; phone; lat; lng; providerSnapshotAt: number | null }
interface PlaceSourceRow extends Base { placeId: string; provider: string; externalId: string }
interface ListRow extends Base { provider: string | null; externalId: string | null; name; description; color; ownerName: string | null; removedAtProvider: number | null; providerSnapshotAt: number | null }
interface ListItemRow extends Base { listId; placeId; position; addedAt; externalId: string | null; providerNote: string | null; providerColor: string | null; removedAtProvider: number | null; providerSnapshotAt: number | null }
interface UserListRow extends Base { listId: string; role: "owner" | "follower" | "collaborator"; removedAt: number | null }
interface UserPlaceRow extends Base { placeId: string; savedAt: number }
// visit_notes, links, place_locations unchanged
// location.ts: AddressSource becomes "import" | "search"

// importContract.ts — neutral
interface ImportContract { provider: string; importedAt: string; complete: boolean; subscriptionKnown: boolean; lists: ImportList[] }
interface ImportList { externalId: string; name: string; description?: string; followed: boolean; ownerName?: string; items: ImportItem[] }
interface ImportItem { externalId: string; placeExternalId?: string; title: string; address?: string; category?: string; phone?: string;
  lat?: number; lng?: number; providerNote?: string; providerColor?: string; localNote?: string; position: number }
// api.ts
interface SearchResult { provider: string; externalId: string; title; address; roadAddress; category; phone; lat; lng }

// providers/kakao.ts
const KAKAO = "kakao";
function kakaoContractToImport(raw: unknown): ImportContract;  // validates kakao-list contract v1 (+ optional subscriptionKnown), maps fields
```

**Mapping in `kakaoContractToImport`:**
- `kakaoFolderId` becomes `externalId` (as a string), and `subscribed` becomes `followed`.
- `favoriteSeq` becomes `externalId`, `placeKey` becomes `placeExternalId`, `kakaoNote` becomes `providerNote`, and `kakaoColor` becomes `providerColor`.
- `subscriptionKnown` defaults to false.

- [ ] **Step 1: Write the failing tests.**
  - **Ids:** each helper matches its pattern.
  - **Push envelope:** a `delete` on `places` passes the envelope (the server rejects it later), and a push to `user_lists` is rejected by the envelope.
  - **`kakaoContractToImport`:**
    - it maps a fixture exactly;
    - `subscriptionKnown` is false when absent;
    - it rejects a contract with `contractVersion: 2`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the existing domain tests to the new names.
- [ ] **Step 4: Run** `pnpm --filter @magomap/domain test`. Expected: PASS.
- [ ] **Step 5: Commit.** The db and api packages don't typecheck until Tasks 2–5, so the gate is run at the end of Task 5. This task commits with `pnpm --filter @magomap/domain test` passing. *(Plan ruling: the rework spans tasks 1–5.)*

### Task 2: Schema and the global write check

**Files:**
- Replace `packages/db/migrations/{sqlite,postgres}/0001_init.sql` with the new schema. Delete migrations 0002–0004; their content is folded in. Nothing is deployed.
- Regenerate `packages/db/src/schema.ts` and `src/columnTypes.ts`.
- Create `packages/db/src/write.ts`, holding `withWrite`, `WriteContext`, `WriteConflictError` and `writeStatements`, moved out of `sync.ts` and made global.
- Test: `packages/db/src/write.test.ts`.

**Schema:**
- **Shared tables** (primary key `id`, plus `seq`, `created_at`, `updated_at`, `deleted_at`, `client_updated_at`):
  - `places` (with a unique index on `id`);
  - `place_sources`, unique on `(provider, external_id)`;
  - `place_locations`;
  - `lists`, unique on `(provider, external_id)` where `provider` is not null;
  - `list_items`.
- **Per-user tables** (primary key `(user_id, id)`, same common columns): `user_lists`, `user_places`, `visit_notes`, `links`.
- **Other tables:**
  - `tombstones`, `import_runs` (with the unique "one running" index), `import_seen`, `users`, `identities`, `sessions`;
  - `sync_state(id INTEGER PRIMARY KEY, change_seq, write_token)`, seeded with one row `id = 1`.
- **Indexes:**
  - `(seq, id)` on shared tables, and `(user_id, seq, id)` on per-user tables;
  - `place_id` on `place_sources` and `place_locations`;
  - `list_id` on `list_items`;
  - `(user_id, place_id)` on `user_places`, and `(user_id, list_id)` on `user_lists`.

**Interfaces:**
- `withWrite<T>(db, decide: (ctx: WriteContext) => Promise<{ statements; result: T }>, claimGuard?): Promise<T>`
- `WriteContext = { seq: number; guard: RawBuilder<boolean> }`
- The mechanism is the same as `withUserWrite`, but on `sync_state` row 1.

- [ ] **Step 1: Write the failing tests** for the write check.
  - Two interleaved writers: the second re-decides.
  - Five conflicts in a row throw `WriteConflictError` and write nothing.
  - Rows written get `seq = previous + 1`.
- [ ] **Step 2: Run, implement, then run again.** Expected: PASS on both dialects.
- [ ] **Step 3: Commit.**

### Task 3: Push on the shared model

**Files:**
- Rewrite `packages/db/src/stores/sync.ts` (push part) on `withWrite`.
- Rewrite `sync.test.ts`, `reviewFixes.test.ts` and `concurrency.test.ts`. Every scenario they cover is kept, translated to the new model. Scenarios about deleting places become "delete on places is not_allowed".

**Rules:**
1. Validation, the `clock_ahead` rejection, coalescing and superseded outcomes stay as before.
2. **Places:**
   - Create only from a search result: `addressSource: "search"`, the id must equal `placeRowId(provider, externalId)`, lat/lng required.
   - The server also writes the `place_sources` row and the user's `user_places` row.
   - Pushing an existing place adds `user_places` if missing, and applies the location rule (history on a move).
   - `delete` is rejected with `not_allowed`.
3. **Lists:**
   - Only own lists (`provider` null).
   - A new own list also gets `user_lists` with role `owner`.
   - An existing list must have a `user_lists` row with role `owner` for this user, and a null `provider`; otherwise `not_allowed`. Provider lists give `provider_owned`.
4. **List items:**
   - The id must equal `ownItemRowId(listId, placeId)`.
   - The list must be an own list this user owns.
   - The place must exist; the server ensures the user's `user_places` row.
5. **Notes and links:**
   - The place must exist, otherwise `missing_parent`. The server ensures `user_places`.
   - An imported note (`origin: "import"`) stays editable, and editing it sets `edited_by_user`.
6. **Tombstones and last-write-wins** stay as before, for lists, items, notes and links.

**Rename:** `RejectReason`'s `kakao_owned` becomes `provider_owned`, and `origin "kakao_list"` becomes `"import"`.

- [ ] **Step 1: Translate and write the failing tests.**
  - Add: an own list id that collides with another user's list gives `not_allowed`, and their list is unchanged.
  - Add: pushing an existing shared place (saved by someone else) creates only this user's `user_places` row.
- [ ] **Step 2: Run, implement, then run again.** Expected: PASS on both dialects.
- [ ] **Step 3: Commit.**

### Task 4: Import on the shared model

**Files:**
- Rewrite `packages/db/src/stores/importRuns.ts` on `withWrite` and the neutral `ImportList`.
- Rewrite `importRuns.test.ts`.

**Rules:**
- **The importer's list row.** Upsert the shared list `providerListRowId`. Write its fields only if `importedAt` is not older than `provider_snapshot_at`.
- **The importer's `user_lists`.**
  - Role is `follower` if `followed`; `owner` if not followed **and** the snapshot has `subscriptionKnown`.
  - Otherwise keep the existing role, defaulting to `follower`.
  - Clear its `removed_at`.
- **Places and sources.**
  - The place is `placeRowId(provider, placeExternalId)`, or `pinRowId(provider, listExternalId, item.externalId)` when there is no place id.
  - Upsert `place_sources` (for pins, `externalId` is `pin:<list>:<item>`).
  - Provider fields and location are written only when the snapshot is not older (history on a move).
  - Ensure the importer's `user_places`.
- **Items.** Upsert `providerItemRowId`. Fields are written only when the snapshot is not older, and `removed_at_provider` is cleared (counted as restored). Record the item in `import_seen`.
- **Imported notes.** `kn_<placeId>_<listId>` per user, as before, with `origin: "import"`.
- **Finish.** For a complete run whose snapshot is not older than the list's `provider_snapshot_at`, items of that list not seen are marked `removed_at_provider`.
- **Complete.**
  - For lists this user has with role `owner`, that are missing from a complete snapshot with `subscriptionKnown`, set the shared `removed_at_provider`.
  - For any other missing list this user has, set this user's `user_lists.removed_at`.
- **Access gained.** When the import creates a `user_lists` row (new, or `removed_at` cleared), the same batch re-stamps `seq = ctx.seq` on that list, its items, their places, `place_sources` and `place_locations`. That's done with scoped `UPDATE … WHERE list_id = ?` and `id IN (SELECT place_id FROM list_items WHERE list_id = ?)` statements, so the next pull delivers them.

- [ ] **Step 1: Write the failing tests.** Translate the plan 01 import tests, then add:
  - **Two users import the same list.** One list, one item per favourite, one place per Kakao place. Roles are `follower` and `owner`; notes stay separate.
  - **An older snapshot after a newer one** changes no shared field and adds no history.
  - **The owner's complete import without the list** marks it removed for everyone. A follower's marks only their own `user_lists`.
  - **A list the owner's import has but without `subscriptionKnown`** marks nothing removed.
  - **Access gained:** after A imported long ago and B imports now, B's pull from a fresh cursor includes the list, its items, places and sources. A pull from A's last cursor also returns them, which is harmless.
  - **Statement and parameter limits** for a 5,000-item list, as before.
- [ ] **Step 2: Run, implement, then run again.** Expected: PASS on both dialects.
- [ ] **Step 3: Commit.**

### Task 5: Pull scope, users store, API and adapter wiring

**Files:**
- `packages/db/src/stores/sync.ts` (pull part).
- `packages/db/src/stores/users.ts`: `deleteAccount` locks `sync_state` first, then deletes the per-user rows, the own lists the user owns, and those lists' items.
- The API:
  - `apps/api/src/sync/routes.ts`;
  - `apps/api/src/import/routes.ts`: the chunk body is the neutral `ImportList`, and the `start` body carries `provider` and `subscriptionKnown`;
  - `apps/api/src/search/routes.ts`: `SearchResult` gets `provider: "kakao"` and `externalId`.
- The scripts: `apps/api/scripts/dev-seed.ts` maps with `kakaoContractToImport`. The test fixtures keep the kakao-list format.

**What `pull` returns** for user U, per table with keyset `(seq, id)`:
- `places`, `place_sources`, `place_locations`: rows whose place is in U's `user_places`;
- `lists`: rows in U's `user_lists` with `removed_at IS NULL`;
- `list_items`: rows whose list is in that set;
- `user_lists`, `user_places`, `visit_notes`, `links`: U's own rows.

- [ ] **Step 1: Write the failing tests.**
  - **Pull scope:** U never receives another user's own list, items, notes or links. An unfollowed list's items stop arriving.
  - **Account deletion:** it leaves shared places and provider lists, and removes U's own lists.
  - **Routes:** translated from the plan 01 tests.
- [ ] **Step 2: Run, implement, then run again.**
- [ ] **Step 3: Gate.** Run `scripts/gate.sh <base of Task 1>`, then smoke-test as in plan 01 Task 7: local D1 with `wrangler dev`, the fake kakao-list and `dev:seed`, for two users who share a list.
- [ ] **Step 4: Commit.**

### Task 6: Docs and the downstream plans

- **The design.** Remove the old per-user data model table, or mark it superseded, so the addendum is the only model.
- **Plan 02:**
  - remove `deletePlace` and the "Delete place" step;
  - add "Remove from list";
  - add a "Saved, not in a list" group;
  - rename to neutral names (`provider`, `externalId`, `providerNote`, `providerColor`, `provider_owned`);
  - colours come from the provider adapter (`providers/kakao` colour map);
  - hide lists whose `user_lists.removedAt` is set.
- **Plan 03:**
  - add `subscriptionKnown: true` to the contract;
  - the browser check (G2) also confirms that owner and follower see the same favourite `seq`.
- [ ] **Commit** with `docs: update design and plans for shared, provider-neutral places`.
