# Map layers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** A layers button offers Map / Skyview / Skyview + labels on Kakao Map (standard map only on OpenStreetMap), remembered per device; the "Map: …" label is removed.

**Architecture:** `MapAdapter` gains a layer setter; the Kakao adapter maps it to Kakao map types, Leaflet supports only `map`. `mapPrefs` stores the choice per device. A layers control sits with the map tools.

**Tech Stack:** React 19, i18next (ko/en), Kakao Maps JS SDK (`MapTypeId`, `setMapTypeId`), Leaflet, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-map-layers-design.md`.

## Global Constraints

- Layers: `map`, `skyview`, `hybrid` (labels: Map / Skyview / Skyview + labels; 지도 / 스카이뷰 / 스카이뷰 + 라벨).
- Kakao: `ROADMAP`, `SKYVIEW`, `HYBRID`. OpenStreetMap: `map` only; others disabled with "Skyview is available on Kakao Map" / "스카이뷰는 카카오맵에서 볼 수 있어요".
- Saved per device in `localStorage["mm.mapLayer.<userId>"]` via `deviceKeys` (so sign-out clears it with the other per-account keys); default `map`.
- Remove the "Map: …" caption (`map.mapBy`, `MapView.tsx`); keep OpenStreetMap's attribution.
- Strings in both `en.json` and `ko.json`; both themes; 44 px targets; WCAG 2.2 AA (menu button with radio items, Escape closes, focus returns).
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only`, `as any`; never delete or weaken tests.
- **Commits:** branch `feat/map-layers`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lands by PR.

## Review Focus

1. **Switching provider with Skyview chosen:** OpenStreetMap shows its standard map without error; back on Kakao Map, Skyview returns. (Task 1.)
2. **Pins on Skyview** stay readable, the selected pin included. (Task 2 screenshots.)
3. **Kakao Map not loaded yet** when a layer is chosen: applied once it loads. (Task 1.)
4. **Storage blocked:** choosing a layer still works for the session. (Task 1.)
5. **Keyboard:** the menu opens, arrows move, Enter picks, Escape closes and focus returns. (Task 2.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Layer in adapters and prefs | code |
| 2 Layers control, caption removed | code, ui, ux, a11y |

---

### Task 1: The layer in the adapters and the saved preference

**Files:** modify `apps/web/src/map/MapAdapter.ts`, `kakaoAdapter.ts`, `leafletAdapter.ts`, `swapAdapter.ts` (re-apply the layer after a swap), `mapPrefs.tsx`, `apps/web/src/data/deviceKeys.ts`; tests next to each.

**Interfaces:**
- `export type MapLayer = "map" | "skyview" | "hybrid"`.
- `MapAdapter.setLayer(layer: MapLayer): void` and `MapAdapter.layers: readonly MapLayer[]` (Kakao: all three; Leaflet: `["map"]`). An unsupported layer falls back to `map` on that adapter without forgetting the saved choice.
- `deviceKeys.mapLayer(userId)` → `mm.mapLayer.<userId>`; `useMapPrefs()` gains `mapLayer` and `setMapLayer` (storage errors ignored, as for the map choice).

- [ ] **Step 1: Write the failing tests:** Kakao `setLayer("skyview")` calls `setMapTypeId(SKYVIEW)` (stub SDK, as the existing Kakao adapter test); before the map loads it's applied on load; Leaflet `setLayer("skyview")` keeps the standard map; prefs default to `map`, persist, survive blocked storage, and are cleared with the account keys; after a provider swap the saved layer is re-applied.
- [ ] **Step 2: Run** the focused tests in `apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement.** Kakao docs: `kakao.maps.MapTypeId` and `Map.setMapTypeId` (cite the URL in the commit).
- [ ] **Step 4: Run** web tests and the gate — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): map layers in the adapters, remembered per device`

### Task 2: The layers control; the "Map: …" caption goes

**Files:** modify `apps/web/src/screens/MapScreen.tsx` (next to the my-location tool), `apps/web/src/map/MapView.tsx` (remove the caption), `apps/web/src/styles/app.css`, `en.json`/`ko.json`; create a small `LayersControl` component with tests; e2e `apps/web/e2e/map-layers.spec.ts`.

**Interfaces:** consumes `useMapPrefs().mapLayer/setMapLayer` and the current adapter's `layers` (Task 1).

- [ ] **Step 1: Write the failing tests:** the control lists the three layers with the current one checked; on OpenStreetMap the two Skyview items are disabled with the hint; choosing calls `setMapLayer`; keyboard (open, arrows, Enter, Escape, focus return); the "Map: …" caption is gone from `MapView` (update its existing test deliberately). E2e (both projects, OpenStreetMap in the test env): the control opens, Skyview is disabled with the hint, Map is checked.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Kakao `HYBRID` = Skyview + labels.
- [ ] **Step 4: Run** web tests, the e2e (`E2E_PORT`/`E2E_FAKE_PORT` if needed) and the gate; screenshots of the control (phone, desktop; light, dark; ko, en) to `tmp/review-shots/map-layers-2/`. Kakao Skyview can't load in the e2e env (no key): say so for the UI review; the owner checks pins on Skyview once on the deployed app.
- [ ] **Step 5: Commit** `feat(web): a layers button (Map / Skyview / Skyview + labels); drop the map label`
