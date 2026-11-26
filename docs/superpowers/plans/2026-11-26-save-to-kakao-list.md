# Save a place to one of her Kakao lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal (issue #83):** her own Kakao lists appear wherever she saves a place to a list. In a browser with the extension the place goes into Kakao Map straight away; on her phone it is kept as a **pending add**, shown as "not yet in Kakao Map", and pushed the next time magomap is open in a browser with the extension.

**Architecture:**
- **Data.** A new per-user synced table `kakao_adds`: one row per (Kakao list, place) she asked to add. Kakao lists and their items stay read-only and owned by the Kakao Map sync; a pending add is never a `list_items` row, so a sync can't remove it and followers never see it.
- **Server.** The push accepts a `kakao_adds` row only for a Kakao list she **owns** (role `owner`, not removed) and a place she can see that has a Kakao place source.
- **Push.** One function, `pushKakaoAdds()`: when the extension answers and pending adds exist, it checks the Kakao Map account, adds each list's places with the extension's `addPlaces` (own-list check, keys already there skipped), then runs a Kakao Map sync. After any pull, a pending add whose list now holds the place is cleared.
- **UI.** The save step on the map, the place's "Add to list" and the list screen show her own Kakao lists and the pending mark.

**Tech Stack:** Kysely (D1, Postgres), Hono, Dexie, React 19, i18next (ko/en), Vitest, Playwright.

## Global Constraints

- **Offered lists:** her own Kakao lists (`sectionOf === "provider"`), never followed ones, and never folder 0 (her default list: the extension refuses folder id 0). Only for a place with a Kakao place source whose id is a Kakao place id (`/^[1-9]\d{0,14}$/`); otherwise the Kakao lists are absent.
- **Row:** `kakao_adds (user_id, id, list_id, place_id, failed, created_at, updated_at, deleted_at, client_updated_at, seq)`, primary key `(user_id, id)`, index `(user_id, seq, id)`. `id = ka_<listId>_<placeId>` (deterministic, so two devices merge). `failed` is null or `"list_missing"`.
- **Server rules:** upsert refused (`not_allowed`) unless the list is a live Kakao list with her `owner` role and the place is one she can see with a live Kakao source; `listId`/`placeId` can't change; deletes always allowed for her own rows. Account deletion and export include the table.
- **Saving:** a Kakao list is offered only for a place she already has (saved, or in one of her lists), which is what the server checks; the map's save step saves the place first, as today. `addToKakaoList` writes only the pending add. It is a local write, so it works offline.
- **Pushing:** never on a phone without the extension; only one push at a time; a push that fails leaves the rows pending (retried next time), except `not_found` from the extension, which marks that list's rows `failed: "list_missing"`. Nothing is logged.
- **Clearing:** after any pull, a pending add whose list holds that place in a live, not-removed item is soft-deleted.
- **Shown:** a pending place appears in that list (list screen, map, place memberships) with the text "Not yet in Kakao Map"; a failed one says why and offers **Remove**.
- **Strings** in `en.json` and `ko.json`. Brand tokens, both themes, 44 px targets.
- **Gate:** `./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Commits** on `feat/save-to-kakao-list`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lands by PR.

## Review Focus

1. **A followed list, someone else's list, a deleted list, or a place with no Kakao id:** never offered, and refused by the server if forged. (Tasks 1, 4.)
2. **The next Kakao Map sync** never removes a pending add, and clears it once Kakao Map has the place. (Tasks 2, 3.)
3. **Phone offline:** saving to a Kakao list works and shows the pending mark; nothing is sent to Kakao. (Tasks 2, 4.)
4. **A push that dies halfway** (extension gone, Kakao signed out): no row is lost, the next push resumes, nothing is added twice. (Task 3.)
5. **The list is gone in Kakao Map:** the place says so and can be removed from the pending list; it stays saved. (Tasks 3, 4.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Table, contract, server rules | code, security |
| 2 Web data: Dexie, writes, library, clearing | code |
| 3 The push | code, security |
| 4 UI, strings, e2e | code, ui, ux, a11y |

---

### Task 1: The table, the contract and the server rules

**Files:** `packages/db/migrations/{sqlite,postgres}/0007_kakao_adds.sql`; `packages/domain/src/{rows.ts,sync.ts,ids.ts}`; `packages/db/src/{schema.ts,columnTypes.ts,mapping.ts,write.ts}`; `packages/db/src/stores/{sync.ts,users.ts,export.ts}`. Tests: `packages/db/src/stores/` (sync rules, deletion, export), `pullPlan.test.ts` covers the index.

- [ ] Tests first: her own Kakao list + Kakao place → accepted and pulled back; a followed list, an own (magomap) list, a removed list, another user's list, a place without a Kakao source, a changed `listId` → refused; delete accepted; account deletion removes the rows; export includes them.
- [ ] Migration, domain row + `kakaoAddRowId`, zod schema (id must equal `ka_<listId>_<placeId>`), db schema and column types, per-user sets, `APPLY_ORDER`, pre-read, an explicit `kakao_adds` branch in the push.
- [ ] Gate, reviewers, commit.

### Task 2: Web data

**Files:** `apps/web/src/data/{db.ts,writes.ts,queries.ts}`, `apps/web/src/components/SyncIndicator.tsx`, i18n `sync.kakaoAdd`.

- [ ] Tests first: `addToKakaoList(listId, placeId)` writes the pending row (again: unchanged; after removal: restored); `removeKakaoAdd(id)`; `clearDoneKakaoAdds()` removes rows whose list now holds the place; the library exposes pending adds; `useListPlaces`, place memberships and markers include pending places marked `pending` (and `failed`); `kakaoListsFor(placeId)` offers only her own Kakao lists except folder 0, and only for a place with a Kakao key.
- [ ] Dexie `version(2)` adds `kakao_adds: "id, listId, placeId"`; `ROW_TABLES`, `TABLES`, `OWN_ROW_TABLES`; clearing runs after every pull.
- [ ] Gate, reviewer, commit.

### Task 3: The push

**Files:** create `apps/web/src/lists/pushKakaoAdds.ts`; extract the place-to-send conversion from `apps/web/src/lists/duplicateToKakao.ts` into a shared helper; trigger from app start / window focus and right after a save to a Kakao list.

- [ ] Tests first: no extension → nothing sent; pending rows → account check, `addPlaces` per list in pages of 50 with the list's folder id, then one Kakao Map sync, then clearing; `not_found` marks that list's rows failed and goes on with the other lists; any other failure stops and keeps every row pending; a second call while one runs does nothing; failed rows aren't sent.
- [ ] Gate, reviewers, commit.

### Task 4: UI, strings, e2e

**Files:** `apps/web/src/map/MapContextMenu.tsx`, `apps/web/src/place/Memberships.tsx`, `apps/web/src/screens/ListScreen.tsx` (and the list row component), i18n, `apps/web/e2e/`.

- [ ] Tests first: the save step and "Add to list" list her own Kakao lists under a "Kakao Map" heading; choosing one writes a pending add and, where the extension answers, starts a push; the pending mark and the failed message with **Remove**; an e2e on the phone project saves a place to a Kakao list offline and sees it in the list as "Not yet in Kakao Map".
- [ ] Screenshots (both themes, phone and desktop) for the UI review.
- [ ] Gate, reviewers, commit, PR.
