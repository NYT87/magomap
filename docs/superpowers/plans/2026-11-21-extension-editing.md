# Edit Kakao notes, visit notes and links from the extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** On a place in Kakao Map, a magomap side panel shows and edits its Kakao note (written to Kakao Map and magomap), visit notes and links; the app's place screen can edit the Kakao note too on a computer with the extension.

**Architecture:**
- **Server:** a one-place read route; a Kakao-note route that records an owner's edit on the shared list item, with an edit time that older imports respect.
- **Extension:** a Kakao provider module (detect the open place, read the account and a favourite, write and verify a note); a side panel UI that reads magomap through the browser's own magomap session; a `magomap.writeKakaoNote` message for the app.
- **App:** the place screen's Kakao note card becomes editable when the extension is present.

**Tech Stack:** TypeScript, Hono on Workers, Kysely (D1 + Postgres), zod, Chrome MV3 (`sidePanel`, `scripting`, content scripts), Vite, React 19 + i18next, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-extension-editing-design.md` (read "Settled after the builder check"). Builds on `docs/superpowers/specs/2026-11-20-kakao-direct-sync-design.md` ("Account mix-ups", "Who owns a list").

**Order:** run this plan **after the direct-sync branch (`docs/kakao-direct-sync-v2`, PR #19) is merged**: it needs `apps/extension`, the Kakao Map binding (`kakao_map_accounts`), the upload routes and each list's recorded Kakao owner id (its Task 5).

## Global Constraints

- **Kakao note writes:** only by the list's Kakao owner (bound Kakao Map account = the list's recorded Kakao owner id); Kakao Map first, verified, then magomap; nothing in magomap changes if Kakao refuses.
- **A note changed underneath** (Kakao's current memo ≠ the text she started from) → nothing written; she picks "Keep mine" or "Use Kakao's".
- **Grouped edit:** editing one note card updates every list she owns that the card covers; followed lists unchanged; partial failures name the lists not updated.
- **Lists with no recorded Kakao owner id** → the note isn't editable: "Sync from Kakao Map once to edit notes on this list".
- **Older imports never revert an edited note:** a server-clock edit time on the list item; an import whose snapshot is older leaves that item's note alone.
- **Who is signed in:** the extension has no magomap login of its own; it calls magomap with the browser's magomap session (host permission for magomap's origin) and the `x-magomap-user` header from `/api/me`. Signed out → "Sign in to magomap in this browser".
- **Account check before every write:** Kakao Map account in the page = the signed-in magomap user's bound account; the panel header shows both; mismatch or no binding → writes blocked.
- **Panel:** Chrome side panel on `map.kakao.com` tabs; follows the place open in the page; online only, nothing queued; visit notes and links through `/api/sync/push`.
- **Provider-ready:** Kakao specifics only in the extension's `providers/kakao` module, behind `MapProvider` (Task 2).
- **Never log** Kakao payloads, notes, cookies or tokens. Strings in `ko.json`/`en.json` (app) and the extension's own messages; both themes; 44 px targets; WCAG 2.2 AA.
- **Database:** migration `0004_kakao_note_edits.sql` in both dialect folders; earlier migrations never edited.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only`, `as any`; never delete or weaken tests.
- **Commits:** branch `feat/extension-editing`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lands by PR.

## Review Focus

1. **Two browsers' sessions disagree:** magomap signed in as him, Kakao Map as her → the panel shows both names, every write is blocked, reading works. (Tasks 3, 4.)
2. **She edited the note in the Kakao Map app since the last sync, then edits from the magomap app (stale copy)** → no silent overwrite; "Keep mine / Use Kakao's". (Tasks 2, 5.)
3. **A grouped note covering an owned and a followed list** → only the owned list's favourite is written; the followed one is untouched. (Tasks 1, 5.)
4. **A kakao-list import older than her edit, run after it** → the note stays as she edited it. (Task 1.)
5. **Kakao Map page markup changes so the open place can't be detected** → the panel says it can't tell which place is open, never shows another place's data. (Task 3.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Server: one-place read, note route, edit time | code, security |
| 2 Extension: Kakao provider module and write message | code, security |
| 3 Extension: side panel (read) | code, ui, ux, a11y |
| 4 Extension: side panel (edit) | code, ui, ux, a11y, security |
| 5 App: edit the Kakao note on the place screen | code, ui, ux, a11y |

---

### Task 1: Server — one place, the Kakao-note route, and edits older imports respect

**Files:**
- Create: `packages/db/migrations/{sqlite,postgres}/0004_kakao_note_edits.sql` (`list_items.note_edited_at` nullable INTEGER/BIGINT); `packages/db/src/stores/kakaoNotes.ts` (+ test); `apps/api/src/places/routes.ts` (+ `apps/api/test/placeRead.test.ts`); `apps/api/src/import/kakaoNoteRoutes.ts` (+ `apps/api/test/kakaoNote.test.ts`)
- Modify: `packages/db/src/schema.ts`, `columnTypes.ts`, `stores/importRuns.ts` (the list-item note decision), `apps/api/src/index.ts` (mount), `packages/domain/src/api.ts` (error codes)
- Test: `packages/db/src/stores/importRuns.test.ts` (add)

**Interfaces:**
- Produces:
  - `GET /api/places/:placeId` (requireUser) → `200 { place, memberships: { listId, listName, itemId, providerNote, role, kakaoOwner: "me" | "other" | "unknown", folderId, seq }[], notes, links }` (the user's visit notes and links as full rows, as pull returns them) or `404`.
  - `POST /api/kakao-notes` (requireUser, allowlist as uploads) with `{ items: { listId: string; itemId: string }[] (1..20), memo: string (≤ LIMITS.importText) }` → `200 { updated: string[] }`; `403 not_allowed`; `409 kakao_account_unconfirmed` (no binding); `403 not_owner` for any item whose list's recorded Kakao owner id isn't the caller's bound account (nothing written); `409 owner_unknown` when the list has no recorded owner id.
  - `recordKakaoNoteEdit(db, userId, items, memo, now)`: writes `provider_note`, `note_edited_at = now`, seq (one guarded write).
  - Import rule: when a list item's `note_edited_at` is newer than the run's `snapshot_at`, the import keeps that item's `provider_note`; all other fields follow existing rules.

- [ ] **Step 1: Write the failing tests** (db tests on both dialects):
  - `an owner's note edit is shared with followers`: she owns L; edit → pull for a follower includes the new `providerNote`.
  - `an older import keeps the edited note`: edit at T5; a kakao-list import with snapshot T3 → note unchanged; an import at T7 → Kakao's value wins.
  - `only the Kakao owner may edit`: a follower → 403 `not_owner`, nothing written; a list without a recorded owner id → 409 `owner_unknown`; no binding → 409 `kakao_account_unconfirmed`.
  - `one request, several owned lists`: two items in two of her lists → both updated; one owned + one followed → 403 and neither written.
  - `the place read`: returns her memberships with `kakaoOwner` (`me` for hers, `other` for a followed list, `unknown` for no recorded id), her own notes and links only (never another user's), 404 for a place she can't see.
  - Write budget: one edit of two items writes at most 2 list-item rows + the write claim (countWrites).
- [ ] **Step 2: Run** the focused tests (`npx vitest run …`) — Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** db + api tests on both dialects and the gate — Expected: PASS.
- [ ] **Step 5: Commit** `feat: read one place and record an owner's Kakao note edit`

### Task 2: Extension — the Kakao provider module and the write message

**Files:**
- Create: `apps/extension/src/providers/types.ts` (`MapProvider`), `apps/extension/src/providers/kakao/` (`detectPlace.ts`, `account.ts`, `favorite.ts`, `writeNote.ts`, tests)
- Modify: `apps/extension/src/readInPage.ts` (move into `providers/kakao`, unchanged behaviour), `apps/extension/src/background.ts` (new message), `manifest`/`vite.config.ts` as needed

**Interfaces:**
- Produces:
  ```ts
  export interface OpenPlace { placeKey?: string; folderId?: number; seq?: string; title?: string }
  export interface MapProvider {
    detectOpenPlace(tabId: number): Promise<OpenPlace | null>;
    readAccount(tabId: number): Promise<{ id: string; nickname?: string } | "signed_out">;
    readFavorite(tabId: number, folderId: number, seq: string): Promise<KakaoFavorite | null>;
    writeNote(tabId: number, f: { folderId: number; seq: string; memo: string; expectedMemo: string }):
      Promise<{ ok: true } | { ok: false; error: "changed" | "signed_out" | "not_found" | "refused" | "unverified" }>;
  }
  ```
  - `writeNote` reads the favourite fresh (all pages of its folder); if its `memo` ≠ `expectedMemo` → `changed` (nothing written); otherwise `POST /favorite/update` with `{ datas: [{ seq, display1, display2, color, memo }] }` (all but `memo` from the fresh read), then re-reads up to 4 times (350 ms apart) until `memo` matches → else `unverified`. Each function injected into the page runs self-contained (`world: "MAIN"`), like `readInPage`.
  - Message from magomap pages: `{ type: "magomap.writeKakaoNote", items: { folderId: number; seq: string }[], memo: string, expectedMemo: string, expectedAccount: string }` → `{ ok: true, written: string[] } | { ok: false, error, written: string[] }`; it first checks `readAccount` equals `expectedAccount` (`account_mismatch` otherwise); opens a background Kakao Map tab if none (as `magomap.read`), closes it after.

- [ ] **Step 1: Write the failing tests** (mocked fetch/window, as `readInPage.test.ts`):
  - `writes the note and verifies it` (update body exact; verify loop);
  - `refuses when the memo changed underneath` (no POST sent);
  - `signed out / favourite gone / refused / never verified` → each error, no false success;
  - `keeps display1, display2 and color from the fresh read`;
  - `detects the open place from the place card link`, and `returns null when nothing is detectable` (never a guess);
  - `the write message checks the account first` (`account_mismatch`, nothing written), `writes several items and reports which were written when one fails`;
  - the bundled self-contained check for every injected function (as the existing dist test).
- [ ] **Step 2: Run** `pnpm --filter @magomap/extension test` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified; port `updateKakaoFavoriteNoteInPageEnvelope` and the place detection from kakao-list (note the origin and commit in the file header).
- [ ] **Step 4: Run** tests, typecheck, both builds — Expected: PASS.
- [ ] **Step 5: Commit** `feat(extension): a Kakao provider module that can write a favourite's note`

### Task 3: Extension — the side panel (reading)

**Files:**
- Create: `apps/extension/src/panel/` (panel page, components, its own small i18n ko/en, styles from the app's tokens), tests
- Modify: `manifest` (`side_panel`, `sidePanel` permission, host permission for magomap's origin from `origins.ts`), `background.ts` (enable the panel on `map.kakao.com` tabs; tell it when the open place changes), `apps/extension/README.md`

**Interfaces:**
- Consumes: Task 1 `GET /api/places/:placeId`, `/api/me`; Task 2 `detectOpenPlace`, `readAccount`.
- Produces: the panel shows, for the open place: header `magomap: <name> · Kakao Map: <nickname> (••••<last 4>) ✓/✗`, title, its lists, the Kakao note grouped as the app groups it (`groupKakaoNotes` logic, copied with a header if it can't be imported), visit notes, links. States: signed out of magomap, signed out of Kakao Map, account mismatch, no place detectable, place not in magomap, loading, offline.

- [ ] **Step 1: Write the failing tests** (Testing Library, with stubbed `chrome` and fetch): one per state above; `follows the open place` (a place-change event re-reads); `never shows a previous place's data while the next loads`; `the header shows both accounts and ✗ when they differ`.
- [ ] **Step 2: Run** the tests — Expected: FAIL.
- [ ] **Step 3: Implement.** Look follows `docs/brand-guidelines.md` and the app.
- [ ] **Step 4: Run** tests and builds; save screenshots (panel states, light and dark) to `.superpowers/…/screens/task-3/` for the UI review — a static harness page is fine (no real Kakao in tests).
- [ ] **Step 5: Commit** `feat(extension): a side panel with the open place's magomap data`

### Task 4: Extension — the side panel (editing)

**Files:**
- Modify: `apps/extension/src/panel/*`, tests

**Interfaces:**
- Consumes: Task 1 `POST /api/kakao-notes`, `/api/sync/push`; Task 2 `writeNote`.
- Produces:
  - **Kakao note card edit** (Edit shown when the card covers at least one list with `kakaoOwner: "me"`; only those lists are written; a card with none is read-only with the spec's line): Save → account check → `writeNote` for each owned favourite the card covers → `POST /api/kakao-notes` with those written → states: saved; `changed` → "Kakao Map has a different note now" with Keep mine / Use Kakao's; partial → which lists didn't update; Kakao ok but magomap failed → "Saved in Kakao Map; it will reach magomap with the next sync".
  - **Visit notes and links:** add/edit/delete through `/api/sync/push` with the app's mutation format (`packages/domain/src/sync.ts`); failure keeps the edit with "Couldn't save — try again"; nothing queued.

- [ ] **Step 1: Write the failing tests:** each save outcome above; `Keep mine` rewrites with the new expected memo, `Use Kakao's` shows Kakao's text and writes nothing; `a card with an owned and a followed list writes only the owned one`; `writes are disabled on account mismatch`; visit note add/edit/delete and link add/delete push the right mutations; a failed push keeps the text.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, builds and the gate; screenshots of the edit states.
- [ ] **Step 5: Commit** `feat(extension): edit the Kakao note, visit notes and links from the panel`

### Task 5: App — edit the Kakao note on the place screen

**Files:**
- Modify: `apps/web/src/place/` (the Kakao note cards: `kakaoNotes.ts`, the card component), `apps/web/src/import/kakaoMap.ts` (reuse `detectExtension`; add `writeKakaoNote` message helper), `ko.json`/`en.json`, tests; `apps/web/e2e/` (extension stubbed)

**Interfaces:**
- Consumes: Task 1 routes and `kakaoOwner`; Task 2 `magomap.writeKakaoNote`.
- Produces: on a computer with the extension, a note card covering lists she owns (`kakaoOwner: "me"`) has Edit; Save sends `magomap.writeKakaoNote` (expectedMemo = the card's text, expectedAccount = her bound account), then `POST /api/kakao-notes` for the written items, then syncs. Same outcome states and wording as Task 4. Without the extension: read-only with "Edit it on your computer with the magomap extension"; followed lists: "Only the list's owner can change this note"; no recorded owner: "Sync from Kakao Map once to edit notes on this list".

- [ ] **Step 1: Write the failing tests:** Edit shown only with the extension and an owned list; each outcome state; `changed` → Keep mine / Use Kakao's; the phone/no-extension line; e2e: open a place, edit its Kakao note with the extension stubbed, the card shows the new text after sync.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, the e2e spec (`E2E_PORT`/`E2E_FAKE_PORT` if needed) and the gate; screenshots phone (read-only line) and desktop (edit), light and dark, ko and en.
- [ ] **Step 5: Commit** `feat(web): edit a Kakao note from the place screen through the extension`
