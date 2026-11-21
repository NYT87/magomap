# The selected place's pin stands out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** While a place's details are open, its pin on the map is bigger, ringed, in its list colour, never clustered and on top, on both maps.

**Architecture:**
- **Data.** `buildMarkers` learns which place is selected and marks that saved marker `selected: true`, with a label saying so.
- **Drawing.** `markerHtml` draws the selected variant. Both adapters keep a selected marker out of the cluster and above other pins.
- **Wiring.** `MapView` reads the open place from the `/places/:id` route.

**Tech Stack:** React 19, wouter, i18next (ko/en), Leaflet + leaflet.markercluster, Kakao Maps JS SDK (`CustomOverlay`, `MarkerClusterer`), Vitest + Testing Library, Playwright (projects `phone`, `desktop`).

**Spec:** `docs/superpowers/specs/2026-11-21-selected-pin-design.md`.

## Global Constraints

- **Selected** = the saved place whose details are open (`/places/<id>`), phone and desktop; not selected once the details close.
- **Look:** bigger than a saved pin (32 px today), with a ring, in the place's list colour; no animation.
- **Never clustered, drawn above every other pin,** on Kakao Map and OpenStreetMap.
- **Label** says it is selected; strings in both `apps/web/src/i18n/en.json` and `ko.json`.
- Previous-location pins, search pins and other saved pins are unchanged.
- Brand colours as CSS variables, both themes; every marker stays a 44 px target (`HIT`).
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Commits:** on branch `feat/selected-pin`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lands by PR (`main` only takes PRs).

## Review Focus

1. **The selected place sits in a cluster when zoomed out:** its pin is still drawn on its own, on top. (Task 2, e2e and adapter test.)
2. **The selected place is in a hidden list, or has no coordinates:** nothing breaks and no selected pin appears. (Task 1.)
3. **Switching from one place to another:** only the new place is selected; the old pin goes back to normal. (Task 2, e2e.)
4. **Dark theme on map tiles:** the ring is visible on light and dark tiles. (Task 2, screenshots for the UI review.)
5. **Previous locations of the selected place:** they stay faded and small, not selected. (Task 1.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Selected marker data and look | code, ui |
| 2 Adapters, wiring and the place list | code, ui, a11y |

---

### Task 1: The selected marker — data, label and look

**Files:**
- Modify: `apps/web/src/map/MapAdapter.ts` (`MapMarker`), `apps/web/src/map/markers.ts` (`MarkerInput`, `buildMarkers`), `apps/web/src/map/useMapData.ts`, `apps/web/src/map/markerHtml.ts`, the pin CSS in `apps/web/src/styles/app.css` (`.mm-pin*`), `apps/web/src/i18n/en.json`, `ko.json`
- Test: `apps/web/src/map/markers.test.ts`, `apps/web/src/map/markerHtml.test.ts` (create)

**Interfaces:**
- Produces:
  - `MapMarker.selected?: boolean` (only ever `true` on a `kind: "saved"` marker).
  - `MarkerInput.selectedPlaceId?: string`.
  - `useMapData(selectedPlaceId?: string)`: passes it to `buildMarkers` and labels the selected marker with `t("map.selectedLabel", { title })`.
  - Strings: `"map.selectedLabel": "{{title}}, selected"` / `"{{title}}, 선택한 장소"`.
  - `markerHtml` for a selected marker: class `mm-pin mm-pin--saved mm-pin--selected`, a bigger SVG pin (40 px, the builder may tune within the brand guidelines) in `m.color`, plus a ring drawn in the SVG (stroke in `var(--color-text)` over a `var(--color-bg)` halo, so it reads on light and dark tiles).

- [ ] **Step 1: Write the failing tests**
  - `markers.test.ts`:
    - `marks the selected place's pin`: with `selectedPlaceId: "p1"`, exactly one marker has `selected: true`, it is `p1`'s `kind: "saved"` marker, and its colour is unchanged from the unselected run.
    - `never marks previous locations or hidden places`: `p1` with previous locations and `showPrevious: true` → its `previous` markers have no `selected`; with `p1` only in a hidden list → no marker is selected.
    - `no selection without an id`: `selectedPlaceId` undefined → no marker has `selected`.
  - `markerHtml.test.ts`:
    - `draws the selected pin bigger, ringed, in its colour`: the HTML has `mm-pin--selected`, an `<svg>` with `width="40"`, the list colour as the pin fill, and a ring element; the unselected saved pin keeps `width="32"` and no `mm-pin--selected`.
    - `escapes the label` (existing behaviour, now pinned for the selected variant too).
- [ ] **Step 2: Run** `npx vitest run src/map/markers.test.ts src/map/markerHtml.test.ts` in `apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement** as specified. In `useMapData`, the selected label wins over the plain title; previous-location labels are unchanged.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @magomap/web test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a selected place's pin — bigger, ringed, in its list colour`

### Task 2: Never clustered, on top, and wired to the open place

**Files:**
- Modify: `apps/web/src/map/leafletAdapter.ts` (`draw`, ~line 36-58), `apps/web/src/map/kakaoAdapter.ts` (`overlay` ~58-70, `setMarkers` ~84-97), `apps/web/src/map/MapView.tsx`, `apps/web/src/map/VisiblePlacesList.tsx`, `apps/web/src/map/MapAdapter.ts` (the `setMarkers` doc comment)
- Test: `apps/web/src/map/leafletAdapter.test.ts`, `apps/web/src/map/VisiblePlacesList` test (create `VisiblePlacesList.test.tsx` if none), `apps/web/e2e/selected-pin.spec.ts` (create)

**Interfaces:**
- Consumes: `MapMarker.selected`, `useMapData(selectedPlaceId)` (Task 1).
- Produces:
  - **Leaflet:** a selected marker goes to the `loose` layer (like search pins), with `zIndexOffset: 1000`.
  - **Kakao:** a selected marker's `CustomOverlay` is set on the map directly (in `loose`), with `zIndex` above the others (e.g. `setZIndex(10)`), `yAnchor` 1 like saved pins.
  - **`MapView`:** `const [, params] = useRoute("/places/:id")`; passes `params?.id` (decoded) to `useMapData`.
  - **`VisiblePlacesList`:** new prop `selectedId?: string`; that row's link gets `aria-current="true"`.

- [ ] **Step 1: Write the failing tests**
  - `leafletAdapter.test.ts` (with the file's existing Leaflet setup): `keeps the selected pin out of the cluster`: after `setMarkers` with one selected and two saved markers, the selected one is on the loose layer with `zIndexOffset` 1000, and the cluster holds exactly the two others.
  - `VisiblePlacesList.test.tsx`: `marks the open place`: with `selectedId: "p1"`, `p1`'s link has `aria-current="true"` and others have none.
  - `e2e/selected-pin.spec.ts` (both projects; dev login and an import as the other specs do, via `importFromKakao` in `e2e/helpers.ts`):
    - `the open place's pin stands out`: open `/places/<BADA>` → exactly one `.mm-pin--selected` in the page, not inside a `.marker-cluster`.
    - `zoomed out, it still isn't clustered`: zoom the map out (desktop: the zoom-out control a few times; phone: the map's zoom control or keyboard `-` on the map) → still exactly one `.mm-pin--selected`.
    - `another place takes over`: open a second place → exactly one `.mm-pin--selected`, and it's the new one (its host's `title`/`aria-label` contains the new title); going back to the map with no place open → zero.
- [ ] **Step 2: Run** the unit tests in `apps/web` and `pnpm --filter @magomap/web exec playwright test e2e/selected-pin.spec.ts` — Expected: FAIL. (Use `E2E_PORT`/`E2E_FAKE_PORT` if the default ports are busy.)
- [ ] **Step 3: Implement** as specified. Pass `selectedId` from `MapScreen` (where `VisiblePlacesList` is rendered) the same way as `MapView`.
- [ ] **Step 4: Run** the web tests, the e2e spec and the gate — Expected: PASS. Save screenshots to `tmp/review-shots/selected-pin-2/` of a place open with its pin visible: phone and desktop, light and dark, OpenStreetMap (Kakao Map isn't available in the e2e environment; say so for the UI review).
- [ ] **Step 5: Commit** `feat(web): the selected pin is never clustered and sits on top`
