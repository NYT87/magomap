# Edit a Kakao note from the place screen — Implementation Plan

> Steps use checkbox syntax. Test first: watch each test fail, then make it pass.

**Goal:** On the place screen the owner can edit the Kakao note under a list chip, for a Kakao list he owns. Kakao Map changes first (through the extension); only after that succeeds does magomap record it. An empty note is allowed and clears it.

**Template:** the colour edit (PR #51): `writeList.ts` op `color`, `magomap.setColor`, `stores/kakaoColors.ts`, `POST /api/kakao-colors`, migration `0005_color_edits`, `setPlaceColor.ts`, `ColorPicker.tsx`.

**Spec:** `docs/superpowers/specs/2026-11-21-extension-editing-design.md` ("Saving a Kakao note", "Editing the Kakao note from the magomap app"). Wire format: `docs/kakao-map-access.md` sections 7 and 8 (`POST /favorite/update`, whole record sent back, only `memo` changes).

## Global Constraints

- Owner only, checked on the server (bound Kakao Map account = the list's recorded owner id), never trusted from the client.
- Nothing is written in magomap unless Kakao Map took the note (verified by reading it again).
- A note that can't be read as text is never sent back as empty; display1/display2 must be text.
- Limit `LIMITS.importText` (5000) everywhere. Empty clears the note.
- Migration `0006_note_edits.sql` in both dialect folders; earlier ones untouched. `note_edited_at` is server-only.
- No outbox entry for the local write (Kakao's own row, like colours). Never log notes.
- No `@ts-ignore`, `biome-ignore`, `.skip`/`.only`.

## Tasks

1. **Extension** `apps/extension/src/writeList.ts`, `background.ts`, `README.md`: op `note` / message `magomap.setNote { folderId, key, note }` (note a string up to 5000, may be empty). Reads the favourite fresh, sends `/favorite/update` with seq, display1, display2, color unchanged and only `memo` changed, reads again until the memo matches (line breaks and edge spaces ignored). Refuses (`kakao_unavailable`, nothing sent) when display1/display2/memo aren't text. Tests in `writeList.test.ts`, `background.test.ts`. README row and a real-browser check step.
2. **Database** migrations `0006_note_edits.sql` (postgres, sqlite), `schema.ts`, `columnTypes.ts`, `mapping.ts` (`SERVER_ONLY_COLUMNS`), `package.json` export `./stores/kakaoNotes`, `stores/kakaoNotes.ts` `recordKakaoNoteEdit` (owner-only, same results as colours, `note_edited_at`, one row, new seq), `importRuns.ts` keeps an edited note when `note_edited_at > snapshotAt`. Test `kakaoNotes.test.ts` (both dialects): owner records, follower refused, no owner / no binding, not found, too long refused, empty clears, older import keeps it, newer replaces.
3. **API** `apps/api/src/import/kakaoMapRoutes.ts`: `POST /api/kakao-notes { listId, itemId, note }` (same error mapping as colours; 400 for a too-long note). Tests in `apps/api/test/kakaoMapImport.test.ts`.
4. **Web logic** `apps/web/src/place/setKakaoNote.ts`: checks he owns the list, `checkKakaoAccount`, the extension, then the server, then a direct Dexie update without outbox. Tests `setKakaoNote.test.ts`: order, nothing recorded when Kakao fails, server failure keeps the local note, empty note, not owner.
5. **Web UI** `place/Memberships.tsx`, new `KakaoNoteEditor.tsx`, `i18n/{ko,en}.json` (`place.kakaoNoteEdit.*`), `styles/app.css`: an Edit button on the note of a Kakao list he owns when the extension answers (also on an empty note, to add one); a labelled textarea, Save and Cancel; Escape cancels; no save on stray keys; focus returns to Edit. Without the extension the note stays read-only with a line. Tests `Memberships.note.test.tsx`.
6. **Verify and ship:** biome, typecheck, vitest per package, own diff review, PR from `feat/edit-kakao-note`.
