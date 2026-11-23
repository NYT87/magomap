# Duplicate a list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** A **Duplicate** action on a list makes a new own list with the same places; for a Kakao list it can also create the copy as a new Kakao list on Kakao Map, through the extension.

**Architecture:**
- **Local copy (Task 1).** One local transaction writes the new own list and its items. It needs nothing new and ships on its own.
- **Owner gate (Task 2).** Kakao Map's create-list and add-places requests are captured from the owner's browser and recorded. Tasks 3 and 4 wait for it.
- **Kakao copy (Tasks 3, 4).** The extension gains three messages (`account`, `createList`, `addPlaces`) that run inside a `map.kakao.com` tab; the app checks the account, creates the list, adds the places, then runs the existing Sync from Kakao Map so the new list appears as his own Kakao list.

**Tech Stack:** React 19, Dexie, i18next (ko/en), Chrome extension (MV3 service worker, `chrome.scripting` in the page's MAIN world), Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-23-duplicate-list-design.md`. Related: `docs/superpowers/specs/2026-11-21-extension-editing-design.md` (how the extension writes to Kakao Map), `docs/kakao-map-access.md`.

## Global Constraints

- **Local copy:** an own list (`provider: null`), one own-list item per **live** place of the source (item not deleted, `removedAtProvider == null`), in the source's order, in one local transaction. Default name `<source name> (copy)` (ko: `<이름> (복사본)`); a blank name is refused; the source is never changed. Available on every real list (not "Saved").
- **Places only:** no Kakao notes, diary notes or links are copied. Each place keeps its **colour**: a local copy stores it as the item colour (`itemColor`, a Kakao colour code, added with migration 0004), and the Kakao copy sends it as the favourite's `color`.
- **Kakao copy:** offered only for a Kakao list (`list.provider === "kakao"`), on a computer where the extension answers. It creates one new Kakao list on his own account and adds each place that has a Kakao place id; places without one are left out and counted. It does **not** also create a local own list; the existing sync brings the new Kakao list in. Never written to a list he doesn't own.
- **Account check before any Kakao write:** the Kakao Map account signed in on the page must equal the account linked to his magomap account; otherwise stop with nothing written.
- **Kakao writes only inside a `map.kakao.com` tab**, sending what Kakao Map's own page sends (the captured requests in `docs/kakao-map-access.md`); each injected function is self-contained (`world: "MAIN"`), like `readInPage`.
- **A retry fills the same Kakao list** (the created list's id is kept); a double confirmation makes one list.
- **Colour edit (Task 5):** on a Kakao list he owns, **Kakao Map first**: the extension changes the favourite's colour in the `map.kakao.com` tab and reads it back; only when that succeeded does magomap record it (the server, then the local row). Any failure before that leaves magomap unchanged. On his own (non-Kakao) lists there is no Kakao side, so the colour is just saved locally and synced. Not offered on a list that isn't his, or without the extension on a Kakao list. Only the 7 Kakao colours (`KAKAO_PLACE_COLORS`).
- **Strings** in `apps/web/src/i18n/en.json` and `ko.json` under `lists.duplicate.*`; both themes; 44 px targets.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Commits:** on branch `feat/duplicate-list`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; lands by PR (`main` only takes PRs). Tasks 3 and 4 may land in a later PR than Task 1.

## Review Focus

1. **A source list with items removed from Kakao, soft-deleted items, or no places:** the copy holds only live places; an empty source makes an empty list. (Task 1.)
2. **Confirming twice quickly:** one list, not two (local and Kakao). (Tasks 1, 4.)
3. **His wife's list:** the Kakao copy is created on **his** account and nothing is written to hers. (Tasks 3, 4.)
4. **A different Kakao account signed in:** nothing is written; a clear message. (Tasks 3, 4.)
5. **A failure midway through adding places, then a retry:** the same Kakao list is filled, with no duplicate places. (Tasks 3, 4.)
6. **Kakao refuses or can't be reached when a colour is changed:** the colour in magomap stays as it was and he sees why; never "changed" in magomap but not in Kakao. (Task 5.)
7. **A colour change on a list that isn't his (his wife's):** not offered; if forced, the server writes nothing. (Task 5.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Local duplicate | code, ux, ui, a11y |
| 2 Owner gate | (the owner) |
| 3 Extension writes | code, security |
| 4 Kakao copy in the app | code, ux |
| 5 Edit a place's colour | code, security, ux, ui, a11y |

When the docs disagree with the plan, the docs win for **how** to call an API; the builder says so in the commit body and keeps the plan's **behaviour**. If the behaviour can't be done as planned, stop and ask.

---

### Task 1: Duplicate a list in magomap

**Files:**
- Modify: `apps/web/src/data/writes.ts`, `apps/web/src/screens/ListScreen.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ko.json`, the stylesheet that styles `mm-place__actions`
- Create: `apps/web/src/lists/DuplicateDialog.tsx`
- Test: `apps/web/src/data/duplicateList.test.ts`, `apps/web/src/lists/DuplicateDialog.test.tsx`, `apps/web/src/screens/ListScreen.test.tsx`

**Interfaces:**
- Produces: `duplicateList(sourceListId: string, name: string): Promise<string>` in `writes.ts`, resolving to the new list's id; throws `Error("blank name")` for a blank (after trim) name and `Error("no such list")` when the source doesn't exist.
- Produces: `DuplicateDialog({ list, onClose }: { list: ListRow; onClose: () => void })` (a `ConfirmDialog`-style modal: name field prefilled with the default name, a "Copy in magomap" button). Task 4 adds the Kakao button to it.
- Consumes: `createList`, `addToList` patterns in `writes.ts` (`tx`, `stamp`, `upsert`, `ownItemRowId`); `useListPlaces`; wouter `useLocation`.

- [ ] **Step 1: Write the failing tests.**
  - `duplicateList.test.ts` (user-database pattern of `data/writes.test.ts`): copying an own list, a Kakao list he owns, and a Kakao list he follows each creates one list with `provider: null`, the given trimmed name, and one live item per live source place, with `position` following the source's order; items whose source item is soft-deleted or `removedAtProvider != null` are not copied; an empty source gives an empty list; the source list and its items are unchanged; Kakao notes aren't copied (`providerNote` is null on the new items); a blank or whitespace name throws and writes nothing; an unknown source throws.
  - `DuplicateDialog.test.tsx`: the name field starts as `<name> (copy)`; "Copy in magomap" with a blank name is disabled; confirming calls `duplicateList` once even when clicked twice quickly, navigates to `/lists/<newId>`, and closes; Escape closes without writing.
  - `ListScreen.test.tsx`: a **Duplicate** button shows for an own list, a Kakao list he owns, and one he follows; not for "Saved".
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/data/duplicateList.test.ts src/lists src/screens/ListScreen.test.tsx` → FAIL.
- [ ] **Step 3: Implement `duplicateList`** in `writes.ts` (one `tx`: read the source's live items ordered by `position`, insert the new list as `createList` does, then one `ownItemRowId(newListId, placeId)` item per place with positions `0…n-1`). Implement `DuplicateDialog` and the **Duplicate** button in `ListScreen`'s action row (shown for any real list, not only own ones); add the strings (`lists.duplicate.title`, `.name`, `.copyHere`, `.defaultName` with `{{name}}`, `.cancel`) in both languages.
- [ ] **Step 4: Run** the same command and `pnpm --filter @magomap/web typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): duplicate a list in magomap`. Save screenshots (phone, desktop, both themes) for the UI review.

### Task 2: Owner gate — capture Kakao Map's create-list and add-places requests

**Files:**
- Modify: `docs/kakao-map-access.md` (a new section "Writing a list")

This is the owner's step; the build pauses and says exactly this:

- [ ] **Step 1: The owner captures two requests** in the browser's Network tab on `https://map.kakao.com` (signed in to his own account): (a) creating a new list; (b) adding one place to that list. For each: the URL, method, JSON body, and the response JSON. No cookies and no headers.
- [ ] **Step 2: The builder records them** in `docs/kakao-map-access.md` as "Writing a list": endpoints, bodies, responses, what identifies the new list in the response, whether a place is added by Kakao place key, and any per-request limits seen. If the add request takes several places at once, that is noted.
- [ ] **Step 3: Decide** from the capture whether adding many places is one request or many, and write the page size into the section. If Kakao Map's own page refuses something the plan assumes (for example it needs a header or token that only its page has), stop and ask the owner.

### Task 3: The extension writes a list

*Waits for Task 2.*

**Files:**
- Create: `apps/extension/src/writeList.ts`
- Modify: `apps/extension/src/background.ts`
- Test: `apps/extension/src/writeList.test.ts`, `apps/extension/src/background.test.ts`, `apps/extension/src/dist.test.ts`

**Interfaces:**
- Produces (messages the page sends with `chrome.runtime.sendMessage`, answered only to magomap's origin like `magomap.read`):
  - `{ type: "magomap.account" }` → `{ ok: true, folders: unknown[] }` (her `/folder/list` records trimmed to the fields magomap's Kakao Map adapter reads, up to 2000) or `{ ok: false, error: "kakao_signed_out" | "kakao_unavailable" | "busy" }`. *Changed in the build (ruling in the ledger):* the extension no longer decides whose account it is; the app does, with the domain's own rule, so the check can't drift from the sync's.
  - `{ type: "magomap.createList", name: string }` → `{ ok: true, folderId: number }` or `{ ok: false, error: … }`. `name` is 1–100 characters.
  - `{ type: "magomap.addPlaces", folderId: number, places: { key: string; title: string; address: string; x: number; y: number; color?: string }[] }` → `{ ok: true, added: number, skipped: number }` (`skipped`: already in the folder, or sent twice), or `{ ok: false, error: …, added?: number }` when it stopped midway (`added` absent: the page itself didn't answer, so read the list again). At most 100 places per message; the page sends 20 per Kakao request. *Changed in the build:* `places`, not `placeKeys`: the captured `/favorite/add` needs the title, address and Kakao's own x/y.
- Produces (`writeList.ts`): self-contained in-page functions `createFolderInPage(name: string)`, `addFavoritesInPage(folderId: number, placeKeys: string[])`, `accountInPage()`, each returning a plain result object (no imports, no closures over module state), run with `world: "MAIN"`.
- A write is refused while another read or write runs (`busy`), like `read`.

- [ ] **Step 1: Write the failing tests.** `writeList.test.ts` (the in-page functions rebuilt away from the bundle against a stubbed `fetch`, as `dist.test.ts` does for `readInPage`): `createFolderInPage` sends exactly the captured request and returns the folder id; `addFavoritesInPage` first reads the folder's current favourites and adds only keys not there (`skipped` counts the rest), and a second call with the same keys adds nothing; a refused or non-JSON answer returns an error, never a success; nothing is logged. `background.test.ts`: the three messages answer only for magomap's origin; `busy` while another runs; a thrown injection is `kakao_unavailable`; `createList` rejects a blank or over-long name. `dist.test.ts`: the built worker is still one self-contained file, release origins unchanged, no `console.`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/extension test` → FAIL.
- [ ] **Step 3: Implement** `writeList.ts` from the Task 2 capture and wire the three messages in `background.ts` (injecting with `chrome.scripting.executeScript`, `world: "MAIN"`, in a Kakao Map tab found or opened as `read` does). No new permission: `host_permissions` already holds `https://map.kakao.com/*`.
- [ ] **Step 4: Run** `pnpm --filter @magomap/extension test`, `typecheck` and `bundle` → PASS.
- [ ] **Step 5: Commit** `feat(extension): create a Kakao Map list and add places to it`.

### Task 4: Copy a Kakao list to Kakao Map from the app

*Waits for Task 3.*

**Files:**
- Create: `apps/web/src/lists/duplicateToKakao.ts`
- Modify: `apps/web/src/import/kakaoMap.ts` (export the extension call), `apps/web/src/lists/DuplicateDialog.tsx`, the i18n files
- Test: `apps/web/src/lists/duplicateToKakao.test.ts`, `apps/web/src/lists/DuplicateDialog.test.tsx`

**Interfaces:**
- Consumes: Task 3's messages (`magomap.account` hands over folder records: run them through the domain's account rule, adding a small export beside `kakaoMapListsToImport` in `packages/domain/src/providers/kakaoMap.ts`, e.g. `kakaoMapAccountOf(folders: unknown[]): string`, so the comparison with the linked account uses exactly the sync's rule; a place's `x`/`y` come from its lat/lng by the section 5 projection of `docs/kakao-map-access.md`, times 2.5, rounded; its `color` is the source item's Kakao colour code, `providerColor` on a Kakao list's item or `itemColor` on an own list's, left out when unknown so the page's default applies); `detectExtension`, the sync's existing way of learning the linked Kakao Map account and of running a sync (find them in `import/kakaoMap.ts`); `placeSourceRowId`/`place_sources` for a place's Kakao key.
- Produces: `duplicateToKakao(input: { sourceListId: string; name: string; resume?: { folderId: number } }): Promise<{ folderId: number; added: number; skipped: number; leftOut: number }>`. It throws `KakaoCopyError` with `code: "extension_missing" | "account_mismatch" | "kakao_signed_out" | "kakao_unavailable" | "busy" | "partial"`, where `partial` carries `{ folderId, added }` so a retry (`duplicateToKakao` again with `resume: { folderId }`) fills the same list.
- Produces: `askExtension(message: { type: string; [k: string]: unknown }, timeoutMs: number): Promise<unknown>` exported from `import/kakaoMap.ts` (today's private `send`).

- [ ] **Step 1: Write the failing tests** (`duplicateToKakao.test.ts`, with `askExtension` and the sync mocked): the order is account → create → add (in pages of the Task 2 size) → sync; a different Kakao account stops before `createList` (`account_mismatch`, no create call); a place with no Kakao key is counted in `leftOut`, not sent; a list of his wife's is sent to his account with only keys, never her list id; a failure after some pages throws `partial` with the created `folderId` and how many were added; resuming with that `folderId` makes no second `createList` and sends the rest; two simultaneous calls make one list. `DuplicateDialog.test.tsx`: **Copy to Kakao Map** is absent for a non-Kakao list and when the extension doesn't answer (with a line saying why); shows progress and the result (`added`, `leftOut`); a `partial` failure shows how many were added and a **Try again** that resumes; the local button still works.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/lists` → FAIL.
- [ ] **Step 3: Implement** `askExtension` (rename `send`'s body, keep behaviour), `duplicateToKakao` and the dialog's second button; strings `lists.duplicate.*` for the Kakao action, progress, result, and each `KakaoCopyError` code in both languages.
- [ ] **Step 4: Run** `pnpm --filter @magomap/web exec vitest run`, `pnpm --filter @magomap/web typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): copy a Kakao list to Kakao Map`. Save screenshots for the UX review.

### Task 5: Change a place's colour from the app, Kakao Map first

*Waits for Tasks 3 and 4's `askExtension`. It has an owner gate (Step 1) and a migration (Step 2).*

**Files:**
- Modify: `docs/kakao-map-access.md` ("Changing a favourite's colour"), `apps/extension/src/writeList.ts` (or a sibling `writeFavorite.ts`), `apps/extension/src/background.ts`, `apps/extension/README.md`, `packages/db/migrations/{sqlite,postgres}/0005_color_edits.sql` (`list_items.color_edited_at` nullable INTEGER/BIGINT), `packages/db/src/schema.ts`, `columnTypes.ts`, `packages/db/src/stores/importRuns.ts` (the colour decision), `packages/db/src/stores/` (a `recordKakaoColorEdit`), `apps/api/src/import/` (the route, mounted in `apps/api/src/index.ts`), `packages/domain/src/api.ts`, `apps/web/src/data/writes.ts`, `apps/web/src/place/Memberships.tsx`, a small `place/ColorPicker.tsx`, the i18n files.
- Create: `apps/web/src/place/setPlaceColor.ts`
- Test: `apps/extension/src/writeList.test.ts`, `packages/db/src/stores/importRuns.test.ts` and a store test (both dialects), `apps/api/test/kakaoColor.test.ts`, `apps/web/src/place/setPlaceColor.test.ts`, `Memberships.test.tsx`

**Interfaces:**
- Consumes: `askExtension` and the account rule (Task 4), `KAKAO_PLACE_COLORS`, `kakaoMapAccountOf`; the list's recorded Kakao owner id (`list.providerOwnerId`) and `place_sources` for the place's Kakao key.
- Produces:
  - Extension message `magomap.setColor` `{ folderId: number; key: string; color: string }` → `{ ok: true }` or `{ ok: false, error: "kakao_signed_out" | "kakao_unavailable" | "not_found" }`. In the page: read the list's favourites fresh (all pages), find the favourite by its place key, send `POST /favorite/update` with `{ datas: [{ seq, display1, display2, color, memo }] }` changing **only** `color` (everything else exactly as just read), then read again until `color` matches (a few short retries). Same self-contained-function and deadline rules as `writeInPage`.
  - `POST /api/kakao-colors` (requireUser, allowlisted) `{ listId: string; itemId: string; color: string /^\d{2}$/ }` → `200 { updated: true }`; `403 not_owner` (the list's recorded Kakao owner id isn't the caller's bound account; nothing written), `409 owner_unknown`, `409 kakao_account_unconfirmed`. It writes that item's `provider_color`, `color_edited_at = now` and its change sequence, one guarded write.
  - Import rule: when an item's `color_edited_at` is newer than the run's `snapshot_at`, the import keeps its `provider_color` (as the Kakao-note edit rule does).
  - `setPlaceColor(input: { itemId: string; color: string }): Promise<void>`: own list → one local update of `itemColor` through the outbox; Kakao list he owns → account check (as Task 4), `magomap.setColor`, then `POST /api/kakao-colors`, then the local `providerColor`. Throws `ColorError` with `code: "extension_missing" | "account_mismatch" | "kakao_signed_out" | "kakao_unavailable" | "not_owner" | "offline" | "server_failed"`; `server_failed` means Kakao has the new colour and magomap doesn't yet (the next Sync from Kakao Map brings it).

- [ ] **Step 1: Owner gate.** The owner captures, on `map.kakao.com` signed in to his own account, the request that changes a saved place's colour (its URL, method, JSON body, response JSON; no cookies or headers). The builder records it in `docs/kakao-map-access.md`. The plan assumes `POST /favorite/update` as the note editing does (`2026-11-21-extension-editing-design.md`); if the colour goes through another request, the builder uses the captured one and says so in the commit body, and stops and asks if the page needs something it can't send.
- [ ] **Step 2: Write the failing tests.** Extension: the order is read → update → read again; only `color` differs from what was read; a place not in the list → `not_found`, nothing sent; Kakao refusing or a read-back that never matches → `kakao_unavailable`; signed out → `kakao_signed_out`. Store/API (both dialects): the owner's edit is shared with followers' pulls; an older import keeps the edited colour and a newer one wins; a follower → `403 not_owner` with nothing written; no recorded owner → `409 owner_unknown`; one edit writes one list-item row plus the write claim; a colour that isn't two digits or isn't a known code is refused. Web: the order is account → extension → route → local; **if the extension fails, neither the route nor the local row is touched**; if the route fails after Kakao succeeded, `server_failed` and the local colour is unchanged; an own-list item makes no extension call; a list that isn't his makes no call at all. `Memberships.test.tsx`: the colour control shows on his own lists, and on a Kakao list he owns only when the extension answers (otherwise disabled with a line saying why); not shown on his wife's list; the saving state, success and each `ColorError` message; the map marker takes the new colour.
- [ ] **Step 3: Run** the focused tests → FAIL.
- [ ] **Step 4: Implement** as specified. The colour control is a row of the 7 colours as a labelled radio group (a `<fieldset>` with a visible or hidden legend, each colour named in both languages, not by colour alone), 44 px targets, both themes; strings under `place.color.*`.
- [ ] **Step 5: Run** extension, db (SQLite and Postgres), api and web suites, `typecheck`, `pnpm exec biome check apps packages scripts` (read all of it) → PASS. Say in the PR that the migration adds only a nullable column.
- [ ] **Step 6: Commit** `feat: change a place's colour from the app, Kakao Map first`. Save screenshots for the UX and UI reviews. The README's real-browser check gains one line: change a colour on a throwaway list and see it in Kakao Map.
