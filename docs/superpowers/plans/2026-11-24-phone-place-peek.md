# Phone: a place opens as a peek over the map, and the Kakao link loads the place — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone, tapping a place shows the map with a small card at the bottom (the place's name) that opens the full details page by dragging it up or tapping an arrow; and the "open in Kakao Map" icon opens the place in the Kakao Map app instead of only launching the app.

**Architecture:** Phone only (desktop keeps its side panel). `/places/:id` on a phone becomes a map route with a `PlacePeek` card above the bottom nav; the full page moves to `/places/:id/details` (the existing `PlaceScreen`). The Kakao link fix is decided from a real-phone test (owner gate) and changes only `kakaoLinks.ts`.

**Tech Stack:** React 19, wouter, i18next (ko/en), Vitest + Testing Library, Playwright (phone 390×844 and desktop).

**Spec:** the owner's request of 2026-11-24 (quoted in "Request" below; no separate design doc).

## Request (owner, 2026-11-24)

1. "On the mobile, when I click on the icon to open on Kakao, it opened on Kakao but it didn't load the place."
2. "When clicking on a place on the mobile, rather than display the details on a full page, it should display the map, like Kakao does, and at the bottom display the name of the place, then that should be draggable to the top to open the current details page, or have an arrow icon to open that screen."

## Global Constraints

- **Phone only:** `useLayout() === "phone"` (below 768 px). Desktop keeps `/places/:id` in the side panel exactly as today; its Escape-to-close and map centring don't change.
- **Every way into a place keeps working:** map marker, search result, list row, "previous location" card, deep link, all go to `/places/:id`. On a phone each now shows the peek.
- **The details page is today's `PlaceScreen`,** unchanged, at `/places/:id/details` on a phone; Back (header arrow or browser back) returns to the peek. On desktop `/places/:id/details` shows the same panel as `/places/:id`.
- **The arrow is the primary way to open details;** dragging up is an enhancement. The peek works with keyboard and screen reader (a real button, reachable in order); no action is drag-only. 44 × 44 px targets; both themes; text uses the text tokens (`--text-*`), no px font sizes (the text-size feature, PR #55).
- **The bottom nav stays visible** under the peek; the peek never covers the nav or the selected pin (the pin is centred; the peek is about 96 px tall).
- **Strings** in `apps/web/src/i18n/en.json` and `ko.json` under `place.peek.*`.
- **Gate:** `pnpm exec biome check apps packages scripts` (read all of it; `scripts/gate.sh` fails locally on stale worktree configs), `pnpm -r typecheck`, `pnpm --filter @magomap/web exec vitest run`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only`, `as any`.
- **Commits** on branch `feat/phone-place-peek`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; lands by PR (`main` takes PRs only).

## Review Focus

1. **Back from details returns to the peek, and Back from the peek returns to where the place was opened** (the map, a list, search), not to a blank map. (Task 2.)
2. **Opening another place while the peek is open** replaces the card without a flicker and keeps the map's zoom (the existing centre-keep-zoom rule). (Task 3.)
3. **A place that doesn't exist, or is deleted, or has no coordinates:** the peek shows the "not found" text or just the name with no map move, never a blank card or a crash. (Task 3.)
4. **Dragging the card must not also pan the map**, and a tap on the card (not the arrow) does nothing surprising: only the arrow button and a drag past the threshold open details. (Task 3.)
5. **Desktop and tablet widths are unchanged:** `/places/:id` still renders the panel; no peek at ≥ 768 px. (Task 2.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Kakao link gate | (the owner) |
| 2 Phone routes | code, ux |
| 3 The peek card | code, ux, ui, a11y |
| 4 Kakao link fix | code |

---

### Task 1: Owner gate — which link loads the place in the Kakao Map app

The app's phone link is `kakaomap://place?id=<id>` (`apps/web/src/place/kakaoLinks.ts`), which launches the app without showing the place. Kakao's documentation of a place-detail scheme could not be confirmed, so this is decided by testing on the phone. The build pauses and says exactly this:

- [ ] **Step 1: The owner tests four links on the phone** that opens the problem (say whether it is iPhone or Android). Take one saved Kakao place (a place's Kakao id is the digits in its "open in Kakao" link; example `1063803587`). In the phone's browser address bar (not a chat app), open each in turn and note which shows the place's page in the Kakao Map app:
  - A. `kakaomap://place?id=1063803587`
  - B. `kakaomap://place?id=1063803587&referer=mplaceweb&infoLevel=2`
  - C. `https://place.map.kakao.com/1063803587`
  - D. `https://map.kakao.com/link/map/1063803587`
- [ ] **Step 2: The builder records the answer** in `docs/kakao-map-access.md` (a short "Opening a place on a phone" section: the phone, the app version if known, which links worked) and picks the first working one in the order B, A, C; if only C or D works, the app uses it as a web link and drops the 1.5 s app-then-web fallback. If none opens the place, stop and ask the owner.

### Task 2: Phone routes — the map with a peek, and the details page

**Files:**
- Modify: `apps/web/src/routes.tsx`, `apps/web/src/layout/AppLayout.tsx`, `apps/web/src/screens/MapScreen.tsx`
- Test: `apps/web/src/layout/AppLayout.test.tsx`, `apps/web/e2e/place.spec.ts`, `apps/web/e2e/selected-pin.spec.ts` (update the phone cases)

**Interfaces:**
- Produces: `placeRouteOf(location: string): { id: string; details: boolean } | null` exported from `apps/web/src/layout/AppLayout.tsx` (or a small `placeRoute.ts` beside it): `/places/:id` → `{ id, details: false }`, `/places/:id/details` → `{ id, details: true }`, else null (the id is URL-decoded with `decodeId`).
- Produces: the phone map is shown (page hidden) for `/` and for `/places/:id`; the page is shown for every other route including `/places/:id/details`. `MapScreen`'s `phoneRoot` overlay (search bar, buttons) stays for `/` only; the peek (Task 3) renders on `/places/:id`.
- Produces: `routes.tsx` serves `/places/:id/details` (desktop and phone) with `PlaceScreen`; on desktop `/places/:id` still serves `PlaceScreen`; on a phone `/places/:id` renders nothing in the page area (the peek is part of the map layer).

- [ ] **Step 1: Write the failing tests** (`AppLayout.test.tsx`, phone width): `/places/p1` shows the map (not hidden) and the bottom nav, and no page header; `/places/p1/details` hides the map and shows the page with the Back button; at desktop width `/places/p1` renders `PlaceScreen` in the panel and `/places/p1/details` renders the same; `placeRouteOf` unit cases (`/places/a%20b`, trailing slash, `/places`, `/lists/x`). In `place.spec.ts` (phone): tapping a marker leaves the map visible and shows the peek's name; the arrow opens the details page; browser back returns to the peek.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/layout` → FAIL.
- [ ] **Step 3: Implement** the route helper, the layout rule above (`atRoot` becomes "a map route"), the `/places/:id/details` route, and keep the heading-focus effect for page routes only. Back on the details page: `history.back()` if there is history, else `navigate("/places/<id>")` (not `/`).
- [ ] **Step 4: Run** `pnpm --filter @magomap/web exec vitest run` and `pnpm --filter @magomap/web typecheck` → PASS. Update the e2e phone cases that expected the full page after tapping a place.
- [ ] **Step 5: Commit** `feat(web): on a phone a place opens over the map, details on their own route`.

### Task 3: The peek card

*Waits for Task 2.*

**Files:**
- Create: `apps/web/src/place/PlacePeek.tsx`, `apps/web/src/place/useDragUp.ts`
- Modify: `apps/web/src/screens/MapScreen.tsx` (render `<PlacePeek id={…} />` on a phone at `/places/:id`), `apps/web/src/styles/app.css`, the i18n files
- Test: `apps/web/src/place/PlacePeek.test.tsx`, `apps/web/src/place/useDragUp.test.ts`, `apps/web/e2e/place.spec.ts`

**Interfaces:**
- Consumes: `usePlace(id)` (`../data/queries`), `useMapStage().setFocus` (centring already happens in `MapView` for the selected place; confirm it also runs on a phone and does not depend on the layout), `placeRouteOf` (Task 2).
- Produces: `PlacePeek({ id }: { id: string }): JSX.Element | null`: a `role="region"` labelled by the place name, above the bottom nav, with the name (a heading level 2), a muted line (category, else the road address or address), an **Open details** button (arrow-up icon, `aria-label` from `place.peek.openDetails`) that navigates to `/places/<id>/details`, and a **Close** button (X, `place.peek.close`) that navigates to `/`. Not found → the existing `place.notFound` text with Close.
- Produces: `useDragUp(opts: { onOpen: () => void; threshold?: number }): { handlers: HTMLAttributes<HTMLElement>; offset: number }`: pointer-based; the card follows the finger upward (offset ≤ 0, clamped), `onOpen` fires on release past `threshold` px (default 64) or a quick upward flick; releasing short of it springs back; the handlers stop the pointer events from reaching the map and set `touch-action: none` on the handle only.

- [ ] **Step 1: Write the failing tests.** `PlacePeek.test.tsx`: shows the name and the category line; **Open details** navigates to `/places/<id>/details`; **Close** navigates to `/`; a place with no category shows the road address, else the address; an unknown id shows the not-found text and Close only; no coordinates → still shows the card; the region is named by the place's name. `useDragUp.test.ts`: a pointer drag up of 80 px calls `onOpen` once; 30 px does not and the offset returns to 0; a drag down or sideways does not; a quick flick (small distance, high speed) opens; pointer cancel resets; events are stopped from propagating. e2e (phone): tap a marker → peek with the name above the nav and the pin visible above it (the selected pin's box is above the peek's top); drag the card up → details page; tap the arrow → details page; Back → peek; Close → map with no peek.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/place` → FAIL.
- [ ] **Step 3: Implement** `useDragUp`, `PlacePeek` and its styles (`.mm-place-peek`: fixed above the nav, `--space-*` tokens, rounded top corners, a small drag handle bar, name in `--text-lg`, muted line in `--text-md`, min-height not fixed height so larger text stretches it, safe-area padding); render it from `MapScreen` for phone `/places/:id`; strings in both languages. Dragging uses `transform: translateY(offset)` only (no layout thrash); respect `prefers-reduced-motion` for the spring-back.
- [ ] **Step 4: Run** `pnpm --filter @magomap/web exec vitest run`, `pnpm --filter @magomap/web typecheck`, `pnpm exec biome check apps packages scripts`, and `pnpm --filter @magomap/web e2e -- e2e/place.spec.ts e2e/selected-pin.spec.ts e2e/text-size-layout.spec.ts` (the text-size layout tests must still pass at the 2× cap: the peek stretches, nothing is cut off, targets stay ≥ 44 px) → PASS.
- [ ] **Step 5: Commit** `feat(web): a peek card with the place's name over the phone map`. Save phone screenshots (light, dark, Korean, 2× text) for the UX and UI reviews.

### Task 4: The Kakao link opens the place

*Waits for Task 1.*

**Files:**
- Modify: `apps/web/src/place/kakaoLinks.ts`, `apps/web/src/place/PlaceScreen.tsx` (only if the winning link is a web link)
- Test: `apps/web/src/place/kakaoLinks.test.ts`, `apps/web/src/place/PlaceScreen.test.tsx`

**Interfaces:**
- Produces: `kakaoLinks(id, point?)` keeps its signature `KakaoLinks | null` (`{ app: string; web: string }`); `app` is the Task 1 winner for a numeric Kakao place id; non-numeric ids (address favourites) keep today's `kakaomap://look?p=` / `map.kakao.com/link/map/…` links. If Task 1 found that only a web link opens the place, `app` equals that web URL and `openKakaoPlace` just navigates to it (no timer).

- [ ] **Step 1: Write the failing tests** in `kakaoLinks.test.ts` with the exact URL the owner's test chose (for example B: `kakaomap://place?id=1063803587&referer=mplaceweb&infoLevel=2`); an address-style id still gives the `look` link; the web link is unchanged; `PlaceScreen.test.tsx`: on a phone the icon's `href` is the new `app` link and on desktop the web link opens in a new tab.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/place/kakaoLinks.test.ts` → FAIL.
- [ ] **Step 3: Implement** the change in `kakaoLinks.ts` (and `openKakaoPlace` if the winner is a web link).
- [ ] **Step 4: Run** `pnpm --filter @magomap/web exec vitest run`, typecheck, biome → PASS. Say in the PR that only the owner's phone proves it, and note the phone/app version from Task 1.
- [ ] **Step 5: Commit** `fix(web): the open-in-Kakao link on a phone loads the place`.

## Self-Review

- **Spec coverage:** request 1 → Tasks 1 and 4; request 2 → Tasks 2 and 3 (drag up and the arrow, both; the name at the bottom of the map).
- **Types:** `placeRouteOf` (Task 2) is used by Task 3; `useDragUp`'s `onOpen` is the same navigation the arrow button uses; `kakaoLinks` keeps its signature.
- **Proportion:** four tasks, one of them the owner's phone test. Tasks 2 to 4 each end with a testable deliverable, and Task 4 can land first once Task 1 is answered.
