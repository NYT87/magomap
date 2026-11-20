# Map provider: Automatic, Kakao or OpenStreetMap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Account gets a Map setting (Automatic by default, Kakao Map, OpenStreetMap). Automatic shows Kakao while the map is centred in Korea and OpenStreetMap elsewhere, switching in place without flicker.

**Architecture:**
- A pure function decides the provider from the setting, the map centre, the provider in use and whether Kakao loaded. Two boxes around Korea stop it flickering at the edge.
- The setting lives in `mapPrefs` (per account, per device), next to the list choices. Whether Kakao loaded is kept there as non-persisted state, so Account can say so.
- `MapView` loads the Kakao SDK at most once. After each user move it asks the rule again; when the answer changes, it replaces the adapter in place, carrying the centre and zoom across.

**Tech Stack:** React 19, Kakao Maps JS SDK, Leaflet + OpenStreetMap, i18next (ko/en), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-map-provider-design.md`

**Order:** after `docs/superpowers/plans/2026-11-20-lists-tab.md`, which also changes `Account.tsx` and `MapScreen.tsx`.

## Global Constraints

- **Strings:** every string exists in both `apps/web/src/i18n/ko.json` and `en.json`.
- **Gate:** `./scripts/gate.sh` must PASS; add `TEST_DATABASE_URL` once local Postgres is back. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`, and never delete or weaken tests.
- **Korea boxes** (map centre):
  - inner: south 33.0, north 38.7, west 124.5, east 131.0;
  - outer: south 32.0, north 39.5, west 123.5, east 132.0.
- **Zoom:** stored Leaflet-style (0–19). The Kakao level is `min(14, max(1, 20 - zoom))` and back again is `20 - level`, kept in one place in `kakaoAdapter.ts`.
- **Kakao unavailable** (no key, script error, 8 s timeout): the provider is always Leaflet, whatever the setting.
- **The decision runs when the user stops moving the map:** Kakao `idle`, Leaflet `moveend`. Never on every frame.

## Review Focus

- **Panning back and forth across the edge**, for example a centre at 39.0°N, 127°E. It must not switch providers repeatedly. Pinned by the rule's tests in Task 1.
- **A switch while a place is open**, or with search results showing: markers, the selected place and search results all survive the swap. Pinned in Task 3.
- **Changing the setting while the map is showing** (desktop, where the map sits beside Account): the map switches right away without a reload. Pinned in Task 3.
- **Kakao blocked**, for example an unregistered domain (as in e2e): Account says Kakao isn't available, and the map is OpenStreetMap whatever the choice. Pinned in Tasks 2 and 3.
- **Kakao's own DOM:** after switching away from Kakao, nothing of Kakao's map is left in the container. Pinned in Task 3.

---

### Task 1: The rule

**Files:**
- Create: `apps/web/src/map/providerChoice.ts`
- Test: `apps/web/src/map/providerChoice.test.ts`

**Interfaces:**
- Produces:
  - `type MapChoice = "auto" | "kakao" | "osm"`
  - `KOREA_INNER` and `KOREA_OUTER`, each `{ south, north, west, east }`
  - `providerFor(choice: MapChoice, center: LatLng, current: MapAdapter["provider"] | null, kakaoAvailable: boolean): MapAdapter["provider"]`
- The rule for `"auto"` is the only part the signature doesn't determine:
  - with no Kakao available: `"leaflet"`;
  - in use Kakao: stay `"kakao"` while the centre is inside OUTER;
  - in use Leaflet, or none yet: `"kakao"` only when the centre is inside INNER.

- [ ] **Step 1: Write the failing tests:**

```ts
const seoul = { lat: 37.57, lng: 126.98 };
const tokyo = { lat: 35.68, lng: 139.69 };
const edge = { lat: 39.0, lng: 127.0 }; // inside OUTER, outside INNER
const dokdo = { lat: 37.24, lng: 131.87 };
it("follows the centre on Automatic", () => {
  expect(providerFor("auto", seoul, null, true)).toBe("kakao");
  expect(providerFor("auto", tokyo, "kakao", true)).toBe("leaflet");
  expect(providerFor("auto", seoul, "leaflet", true)).toBe("kakao");
});
it("doesn't flip at the edge", () => {
  expect(providerFor("auto", edge, "kakao", true)).toBe("kakao");
  expect(providerFor("auto", edge, "leaflet", true)).toBe("leaflet");
  expect(providerFor("auto", dokdo, "kakao", true)).toBe("kakao");
});
it("obeys a forced choice", () => {
  expect(providerFor("kakao", tokyo, "leaflet", true)).toBe("kakao");
  expect(providerFor("osm", seoul, "kakao", true)).toBe("leaflet");
});
it("uses OpenStreetMap whenever Kakao isn't available", () => {
  expect(providerFor("kakao", seoul, null, false)).toBe("leaflet");
  expect(providerFor("auto", seoul, null, false)).toBe("leaflet");
});
```

- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/map/providerChoice.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** `providerChoice.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(web): choose the map provider by setting and by where the map is`.

### Task 2: The setting in Account

**Files:**
- Modify: `apps/web/src/map/mapPrefs.tsx`
  - `MapPrefs` gains `mapChoice: MapChoice` and `setMapChoice(c: MapChoice)`, stored under `mm.mapProvider.<userId>`. A missing or unknown stored value means `"auto"`.
  - It also gains non-persisted `kakaoAvailable: boolean | null` (null until the map has tried) and `setKakaoAvailable(v: boolean)`.
- Modify: `apps/web/src/screens/Account.tsx`. In the language card, below the language select, add a "Map" select with three options, a hint, and a note shown when `kakaoAvailable === false`.
- Modify: `apps/web/src/i18n/ko.json`, `en.json`:
  - `account.map`: "지도" / "Map";
  - `account.mapAuto`: "자동" / "Automatic";
  - `account.mapKakao`: "카카오맵" / "Kakao Map";
  - `account.mapOsm`: "OpenStreetMap" in both;
  - `account.mapHint`: "자동은 한국에서는 카카오맵을, 다른 곳에서는 OpenStreetMap을 써요." / "Automatic uses Kakao Map in Korea and OpenStreetMap elsewhere.";
  - `account.mapKakaoUnavailable`: "지금은 카카오맵을 쓸 수 없어서 OpenStreetMap을 보여 줘요." / "Kakao Map isn't available right now, so the map shows OpenStreetMap."
- Test: `apps/web/src/screens/Account.test.tsx`. `renderAccount` wraps in `<MapPrefsProvider userId="u1">`, which the app already has above Account.

- [ ] **Step 1: Write the failing tests:**

```tsx
it("offers the map choice, Automatic by default, and remembers it", async () => {
  await i18n.changeLanguage("en");
  const user = userEvent.setup();
  const first = renderAccount();
  const map = screen.getByRole("combobox", { name: "Map" });
  expect(map).toHaveValue("auto");
  expect(screen.getByText("Automatic uses Kakao Map in Korea and OpenStreetMap elsewhere.")).toBeInTheDocument();
  await user.selectOptions(map, "osm");
  first.unmount();
  renderAccount();
  expect(screen.getByRole("combobox", { name: "Map" })).toHaveValue("osm");
});
```

  In a `mapPrefs` test (new file `apps/web/src/map/mapPrefs.test.tsx`): a stored `"bogus"` value reads back as `"auto"`; after `setKakaoAvailable(false)`, `kakaoAvailable` is `false` and nothing is written to `localStorage`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/screens/Account.test.tsx src/map/mapPrefs.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the changes listed under Files.
- [ ] **Step 4: Run** the same command. Expected: PASS, with every existing Account test still passing.
- [ ] **Step 5: Commit**: `feat(web): map setting in Account`.

### Task 3: Switching in place

**Files:**
- Modify: `apps/web/src/map/MapAdapter.ts`. Add to `MapAdapter`:
  - `getZoom(): number`, Leaflet-style;
  - `onViewChange(cb: () => void): void`, called after the user stops moving the map.
- Modify: `apps/web/src/map/kakaoAdapter.ts`:
  - export `kakaoLevel(zoom)` and `zoomFromKakaoLevel(level)`;
  - implement `getZoom` and `onViewChange` (on `idle`);
  - `destroy()` empties the container it mounted into.
- Modify: `apps/web/src/map/leafletAdapter.ts`. Implement `getZoom` and `onViewChange` (on `moveend`).
- Modify: `apps/web/src/map/loadMapAdapter.ts`:
  - split into `loadKakaoSdk(key: string | null, opts?: { timeoutMs?: number }): Promise<boolean>`, cached so it runs once per page;
  - add `createAdapter(provider: MapAdapter["provider"]): MapAdapter`;
  - keep `loadMapAdapter` working on top of them for its existing tests.
- Create: `apps/web/src/map/swapAdapter.ts`, exporting `swapAdapter(old: MapAdapter, next: MapAdapter, el: HTMLElement): void`. It reads the old centre and zoom, destroys the old adapter, and mounts the next one at that centre and zoom.
- Modify: `apps/web/src/map/MapView.tsx`:
  - on load: `kakaoAvailable = await loadKakaoSdk(key)`, then `setKakaoAvailable(kakaoAvailable)`, `providerFor(mapChoice, DEFAULT_VIEW.center, null, kakaoAvailable)`, and mount;
  - on `onViewChange`, and whenever `mapChoice` changes: recompute; on a change, `swapAdapter`, then `stage.map.current = next` and `setAdapter(next)`.
  - The existing effects re-apply markers and selection for the new adapter. `fitted` stays true, so a swap never refits.
- Modify: `apps/web/src/map/loadMapAdapter.test.ts` (existing).
- Test: `apps/web/src/map/swapAdapter.test.ts`, and a test for the zoom round trip.

- [ ] **Step 1: Write the failing tests:**
  - `swapAdapter` with two fake adapters: the next one is mounted with `{ center: old.getCenter(), zoom: old.getZoom() }`, and the old one's `destroy` was called once.
  - `zoomFromKakaoLevel(kakaoLevel(z)) === z` for z from 6 to 19, and `kakaoLevel(3) === 14` (clamped).
  - `loadKakaoSdk(null)` resolves `false` without adding a script. Two calls with a key add one script.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/map`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the changes listed under Files.
- [ ] **Step 4: Run** `pnpm --filter @magomap/web exec vitest run`. Expected: PASS.
- [ ] **Step 5: e2e.** Add to `apps/web/e2e/lists.spec.ts` (from the Lists plan), or a new `map-provider.spec.ts`. In e2e there's no Kakao key (`KAKAO_JAVASCRIPT_KEY:` is empty in `playwright.config.ts`). So:
  - Account shows the note that Kakao isn't available, and the Map select still saves "OpenStreetMap".
  - The map caption reads "Map by OpenStreetMap".
  - Run `pnpm --filter @magomap/web exec playwright test`. Expected: all pass. Restore re-captured homepage screenshots with `git checkout`.
- [ ] **Step 6: Check by hand on the deployed app**, where Kakao loads, then report it to the owner:
  - Seoul shows Kakao;
  - panning to Tokyo switches to OpenStreetMap once the drag stops;
  - panning back switches to Kakao;
  - choosing OpenStreetMap in Account switches immediately.
- [ ] **Step 7: Run the gate.** Expected: `GATE: PASS`.
- [ ] **Step 8: Commit**: `feat(web): switch between Kakao Map and OpenStreetMap as the map moves`.
