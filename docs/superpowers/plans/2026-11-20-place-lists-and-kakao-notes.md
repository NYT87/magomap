# Place screen: lists on top, Kakao notes on their own — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a place's screen, the lists it belongs to come first, right under the header. Each Kakao note appears as its own readable card, no longer as 12-px grey text inside a list chip.

**Architecture:**
- A pure helper (`place/kakaoNotes.ts`) groups the place's memberships into note cards, one per distinct note text, each naming the lists it comes from.
- `place/Memberships.tsx` renders the chips (name, colour and state only), then a "Kakao notes" block of cards, then the existing "Add to list" form.
- `place/PlaceScreen.tsx` moves `<Memberships>` from last to first after the header.

**Tech Stack:** React 19, i18next (ko/en), Vitest + Testing Library, Playwright screenshots.

**Spec:** the owner's request of 2026-11-20:
> "on the place details, the list connected appear on the bottom, it should appear on top, and also we need to redesign the component, as kakao note is not clearly visible, and not intuitive, so the note should be displayed separate from the list item"

The design calls in "Decided" below are mine (the planner's), open to correction. Also read `docs/brand-guidelines.md`.

## Decided

- **Order** in the place screen, on phone and desktop: header (title, category, address, actions, moved note) → **Lists** → Diary → Links.
- **Chips** keep the swatch, the list name, the "Removed from Kakao" line and the remove button on own lists. They no longer contain the Kakao note.
- **Kakao notes block**: inside the Lists section, after the chips and before the "Add to list" form.
  - It has a small heading, `h3` "카카오 메모" / "Kakao notes". There is no block at all when there are no non-empty notes.
  - **One card per distinct note text.** The same note in two lists (owner's and follower's copies, or a place in two of her lists) shows once.
  - Each card shows:
    - an attribution line: the swatches and names of the lists it comes from, e.g. "제주 카페 · 가 볼 곳", in membership order;
    - the note at body size (16 px, primary text colour, line breaks kept);
    - a muted footer, "카카오맵에서만 바꿀 수 있어요." / "Change it in Kakao Map."
  - Notes from memberships **removed from Kakao** are still shown, never hidden. Their list name in the attribution carries "(카카오에서 삭제됨)" / "(Removed from Kakao)".
  - Note texts are compared after trimming; the text shown is the first membership's, trimmed.
- **Look:** use the existing `mm-card` (Surface background, 16 px radius). The note text sits under a 3 px left rule in the list's Kakao colour (`membershipColor`), so it reads as quoted from Kakao. Contrast holds in both themes.

## Global Constraints

- **Strings** exist in both `ko.json` and `en.json` under `place.*`. New keys: `kakaoNotes`, `kakaoNoteReadOnly` and `removedSuffix`. The existing `place.kakaoNote` stays, used as the card's accessible label.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh`.
  - No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`.
  - Never weaken tests.
- **Layouts and themes:** both themes and both layouts (phone < 768 px, desktop side panel). Touch targets are at least 44 px.
- **No data changes:** this is display only. Membership rows, sync and the read-only rules are untouched.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `main` (owner's choice). If PR #2 (`fix/kakao-folder0-and-address-links`, which also edits `PlaceScreen.tsx`) is still open, rebase onto it after it merges.

## Review Focus

- **A long Kakao note** (several lines, or one long URL) must wrap inside the card at 360 px with no horizontal scroll. Pinned in Task 1, with `overflow-wrap: anywhere` and a test fixture note containing a 120-character URL; checked again in Task 2's screenshots.
- **The same note on two memberships** shows once, naming both lists. Pinned in Task 1.
- **A note only on a membership removed from Kakao** stays visible and is labelled. Pinned in Task 1.
- **A place with no lists at all.** "Not in any of your lists yet." and the add form now sit at the top, and there is no empty notes heading. Pinned in Task 1.
- **Screen readers.** The notes block is reachable as its own heading, and each note is announced with its lists. Pinned in Task 1 with a role and name query.

---

### Task 1: Kakao notes as their own cards

**Files:**
- Create in `apps/web/src/place/`: `kakaoNotes.ts` and `kakaoNotes.test.ts`.
- Modify:
  - `apps/web/src/place/Memberships.tsx` and `Memberships.test.tsx`;
  - `apps/web/src/place/testData.ts`: add a second membership with the same note, and a removed membership with a long note;
  - `apps/web/src/styles/app.css`: add `.mm-kakao-notes`, `.mm-kakao-note`, `.mm-kakao-note__from` and `.mm-kakao-note__text`;
  - `apps/web/src/i18n/ko.json` and `en.json`.

**Interfaces:**
- Consumes `usePlaceMemberships(placeId)`, which returns `{ item: ListItemRow; list: ListRow; section: ListSection }[]`, and `membershipColor(item, list)` from `map/markers`.
- Produces:

  ```ts
  export interface KakaoNoteCard {
    text: string;
    from: { listId: string; name: string; color: string; removed: boolean }[];
  }
  export function groupKakaoNotes(
    memberships: { item: ListItemRow; list: ListRow }[],
  ): KakaoNoteCard[];
  ```

- [ ] **Step 1: Write the failing tests.**
  - `kakaoNotes.test.ts`:
    - `skips memberships without a note, or with only spaces` gives `[]`.
    - `one card per distinct note, in membership order`: notes "a", "b", " a " give two cards. The first card's `from` names both lists that had "a", and its text is `"a"`.
    - `marks lists removed from Kakao`: `from[i].removed === true` when `item.removedAtProvider != null`.
    - `uses the membership's Kakao colour`: `from[0].color === membershipColor(item, list)`.
  - `Memberships.test.tsx`:
    - `shows Kakao notes apart from the chips`:
      - the chip for 제주 카페 (`getByRole("listitem")` filtered by name) does **not** contain "창가 자리";
      - `getByRole("heading", { name: "Kakao notes" })` exists;
      - "창가 자리" appears exactly once, in an element with `aria-label` starting "Kakao note";
      - "Change it in Kakao Map." is shown.
    - `names every list a shared note comes from`: the seeded duplicate gives one card whose attribution contains both list names.
    - `keeps a note from a list removed from Kakao, labelled`: the attribution contains "(Removed from Kakao)".
    - `no notes, no heading`: a place whose memberships have no notes has no "Kakao notes" heading.
    - Both existing tests stay and still pass.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/place`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Implement `groupKakaoNotes`.
  - In `Memberships`, remove the note span from the chip.
  - After the `<ul className="mm-chips">`, render `<section className="mm-kakao-notes" aria-labelledby=…>` with the `h3` and one `<figure className="mm-card mm-kakao-note" aria-label={`${t("place.kakaoNote")}: ${names}`}>` per card:
    - `<figcaption className="mm-kakao-note__from">` holds the swatches and names;
    - `<p className="mm-kakao-note__text">` holds the note;
    - `<p className="mm-muted">` holds `kakaoNoteReadOnly`.
  - Styles:
    - `.mm-kakao-note__text`: 16 px, primary text, `white-space: pre-wrap`, `overflow-wrap: anywhere`, `border-inline-start: 3px solid var(--note-color)`, `padding-inline-start: var(--space-sm)`. Set `--note-color` inline from `from[0].color`.
    - `.mm-kakao-note__from`: 14 px, secondary text, wraps.
  - Strings:

    | key | ko | en |
    |---|---|---|
    | `kakaoNotes` | 카카오 메모 | Kakao notes |
    | `kakaoNoteReadOnly` | 카카오맵에서만 바꿀 수 있어요. | Change it in Kakao Map. |
    | `removedSuffix` | (카카오에서 삭제됨) | (Removed from Kakao) |
- [ ] **Step 4: Run** the place tests, then the gate. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(web): show Kakao notes as their own cards on a place`.

### Task 2: Lists first on the place screen

**Files:**
- Modify `apps/web/src/place/PlaceScreen.tsx`: render `<Memberships>` right after `</header>`, before `<Diary>`.
- Test: `apps/web/src/place/reviewFixes.test.tsx`, or a new `PlaceScreen.test.tsx` if that file doesn't render the whole screen.
- Modify `apps/web/e2e/screenshots.spec.ts` if the place screen isn't already captured.

**Interfaces:**
- Consumes Task 1's `Memberships` (unchanged props: `{ placeId: string }`).

- [ ] **Step 1: Write the failing test** `lists come before the diary and links`. Render `PlaceScreen` for the seeded place and take the `h2` headings in document order. Expected `["Lists", <diary heading>, <links heading>]`, using the strings from `en.json`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/place`. Expected: FAIL (the order is Diary, Links, Lists).
- [ ] **Step 3: Move `<Memberships placeId={id} />`** above `<Diary placeId={id} />`.
- [ ] **Step 4: Run** the tests and the gate. Expected: PASS.
  - Save screenshots of the seeded place to `tmp/review-shots/place-lists-notes-2/` at 390×844 and 1440×900, light and dark. Include one with the long-URL note.
  - **Open it once** in `pnpm --filter @magomap/web dev` on a phone-width window and check that the first screen shows the lists without scrolling past the diary.
- [ ] **Step 5: Commit** with `feat(web): show a place's lists first`.
