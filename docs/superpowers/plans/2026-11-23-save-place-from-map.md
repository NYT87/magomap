# Save a place from the map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task follows `docs/superpowers/build-process.md` (builder → gate → reviewers).

**Goal:** Right-click (long-press on a phone) on the map lists the Kakao places nearest the click; she picks one, picks one of her own lists, and lands on that place's details page.

**Architecture:**
- **Server.** A new `GET /api/search/nearby` asks Kakao Local's category search around the point and returns the same signed `SearchResult`s as search, each with a distance beside it.
- **Data.** The web app fetches it, works out locally which places she already has, and saves with the existing `savePlaceFromSearch` plus `createList` and `addToList`.
- **Map and UI.** `MapAdapter` gains `onContextPress`; a menu (popover on desktop, `Sheet` on phones) runs the two steps, and `MapView` wires it.

**Tech Stack:** Hono on Cloudflare Workers, Kakao Local REST API, React 19, wouter, i18next (ko/en), Dexie, Leaflet, Kakao Maps JS SDK, Vitest + Testing Library + msw (`@msw/cloudflare`), Playwright (projects `phone`, `desktop`).

**Spec:** `docs/superpowers/specs/2026-11-23-save-place-from-map-design.md`.

## Global Constraints

- **Lookup:** radius about **50 m**, sorted by distance, at most **8** results, at most **6 Kakao calls per press**, made in parallel. These three are constants in `apps/api/src/search/nearby.ts`.
- **Results are the same signed `SearchResult`s** as `/api/search/places` (`signSearchResult`); `distanceM` sits beside each one, outside the signature. `SearchResult`, search and import code don't change. The shared-places rule (signed sources only) is unchanged.
- **Only her own lists** (`list.provider === null`) are offered, plus "No list" and "New list". No Kakao lists, no writes to Kakao.
- **The Kakao REST key stays on the server.** The per-user rate limit (`SEARCH_LIMITER`) counts once per press.
- **Only the lookup needs a connection.** The save, new list, add and navigation are local writes. Order: save the place, create the list when asked, add to it, open `/places/<id>`.
- **A place she already has:** step two is always shown; the save is skipped when `user_places` holds it live, the add is skipped when she's already in the list, "No list" on a saved place changes nothing; lists she's in are marked "already in". A soft-deleted `user_places` row counts as not saved (saving restores it). The check is local, by `p_kakao_<id>`.
- **Each row shows** name, category, road address (or address) and distance. No map highlight of candidates.
- **Press, not tap:** right-click, or a long-press of 500 ms that moves under 10 px. A drag, pinch, normal tap or marker click never opens the menu. The browser's own context menu is suppressed on the map.
- **Opening without a mouse:** the `ContextMenu` key or `Shift+F10` on the focused map opens the menu at the map's centre.
- **Strings** in both `apps/web/src/i18n/en.json` and `ko.json`, under `map.save.*`. Brand colours as CSS variables, both themes; every control a 44 px target.
- **Gate:** `TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test ./scripts/gate.sh <task base>` → `GATE: PASS`. No `@ts-ignore`, `biome-ignore`, `.skip`/`.only` or `as any`; never delete or weaken tests.
- **Commits:** on branch `feat/save-place-from-map`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; lands by PR (`main` only takes PRs).

## Review Focus

1. **A press on a place she already saved:** it appears first, marked as saved, and choosing it only adds it to a list. (Tasks 2, 4.)
2. **Two presses in a row, or a press while the menu is open:** the later press replaces the menu; a slow first lookup never overwrites the second. (Task 4.)
3. **Offline, rate-limited, Kakao down, or nothing nearby:** a clear message, nothing saved, the menu still closes with Escape. (Tasks 1, 4.)
4. **Phone long-press:** lifting the finger doesn't also open a place, scroll, or zoom; a pan or pinch never counts. (Task 3.)
5. **"New list" with an empty or blank name:** the save button is disabled and no list is created. (Task 4.)

## Reviewers

| Task | Reviewers |
|---|---|
| 1 Nearby route | code, security |
| 2 Data: lookup, known state, save flow | code |
| 3 Adapters: `onContextPress` | code |
| 4 Menu, wiring, strings, e2e | code, ui, ux, a11y |

When the docs disagree with the plan, the docs win for **how** to call the API (Kakao Local category search: `https://developers.kakao.com/docs/latest/en/local/dev-guide#search-by-category`; Leaflet `contextmenu`; Kakao Maps `rightclick`). The builder says so in the commit body and keeps the plan's **behaviour**. If the behaviour can't be done as planned, stop and ask.

---

### Task 1: The nearby route

**Files:**
- Create: `apps/api/src/search/kakaoLocal.ts`, `apps/api/src/search/nearby.ts`
- Modify: `apps/api/src/search/routes.ts`, `packages/domain/src/api.ts` (next to `SearchResult`)
- Test: `apps/api/test/search.test.ts` (a new `describe("nearby places")`)

**Interfaces:**
- Produces (domain): `export interface NearbyResult { result: SearchResult; distanceM: number }`.
- Produces (route): `GET /api/search/nearby?lat=<n>&lng=<n>` → `200 { results: NearbyResult[] }` nearest first; `400 { error: "invalid" }` when `lat`/`lng` are missing, not finite, or outside −90…90 / −180…180; `429 { error: "rate_limited" }`; `502 { error: "search_unavailable" }` when every Kakao call fails (a group that fails alone is skipped); `401` when not signed in (same `requireUser` as search).
- Produces (`kakaoLocal.ts`): `export interface KakaoDocument` (moved from `routes.ts`, plus `distance?: string`) and `export function toSearchResult(d: KakaoDocument): Omit<SearchResult, "signedAt" | "signature"> | null` (null when the id or coordinates are unusable), used by both routes.
- Produces (`nearby.ts`): `export const NEARBY_RADIUS_M = 50`, `NEARBY_MAX_RESULTS = 8`, `NEARBY_CATEGORY_GROUPS = ["FD6", "CE7", "MT1", "CS2", "AT4", "AD5"] as const` (restaurants, cafés, large marts, convenience stores, attractions, lodging; six, the ceiling).

- [ ] **Step 1: Write the failing tests** in `search.test.ts`, mocking `https://dapi.kakao.com/v2/local/search/category.json` with msw:
  - `returns the nearest places first, merged across groups, de-duplicated by id, capped at 8, signed`: groups answer with overlapping ids and `distance` strings; the body's `results[i].distanceM` is a number, ascending; the same id from two groups appears once; at most 8; `verifySearchSignature("s".repeat(48), r.result)` is true for each.
  - `asks Kakao once per group, around the point, within 50 m, nearest first`: exactly 6 requests, each with `category_group_code` one of the six, `x` = lng, `y` = lat, `radius=50`, `sort=distance`, and the `KakaoAK` authorization header.
  - `refuses a missing, non-numeric or out-of-range point`: 400 for no params, `lat=abc`, `lat=91&lng=0`, `lat=0&lng=181`.
  - `skips a group that fails and answers 502 only when all fail`.
  - `answers 429 when the limiter refuses` (pass a `SEARCH_LIMITER` override to `call`, as the existing search test does), and `401 without a session`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/api exec vitest run test/search.test.ts` → the new tests FAIL (404).
- [ ] **Step 3: Extract** `KakaoDocument` and the document→result mapping from `routes.ts` into `kakaoLocal.ts` (`toSearchResult`); `/search/places` uses it and its existing tests still pass.
- [ ] **Step 4: Implement** `searchRoutes.get("/search/nearby", …)` in `routes.ts`: validate, one `SEARCH_LIMITER.limit({ key })`, `Promise.allSettled` over `NEARBY_CATEGORY_GROUPS` (query `size=NEARBY_MAX_RESULTS`), merge by `externalId` keeping the smaller distance, sort by `distanceM` (a missing `distance` sorts last), slice to `NEARBY_MAX_RESULTS`, sign each with `signSearchResult`, answer `NearbyResult[]`. `distanceM = Number(d.distance)`, rounded.
- [ ] **Step 5: Run** the API suite (`pnpm --filter @magomap/api exec vitest run`) → PASS.
- [ ] **Step 6: Commit** `feat(api): nearby Kakao places for a map point`.

### Task 2: The data side

**Files:**
- Create: `apps/web/src/map/nearby.ts`, `apps/web/src/data/placeState.ts`, `apps/web/src/data/saveFromMap.ts`
- Test: `apps/web/src/map/nearby.test.ts`, `apps/web/src/data/placeState.test.ts`, `apps/web/src/data/saveFromMap.test.ts`

**Interfaces:**
- Consumes: `NearbyResult` (Task 1); `apiFetch`, `ApiError`, `NetworkError` from `../api/client`; `savePlaceFromSearch`, `createList`, `addToList` from `./writes`; `currentDb`; `LatLng`.
- Produces:
  - `fetchNearby(point: LatLng): Promise<NearbyResult[]>` (GET `/api/search/nearby?lat=&lng=`; lets `NetworkError`/`ApiError` through).
  - `type NearbyFailure = "offline" | "rate_limited" | "unavailable"` and `nearbyFailure(error: unknown): NearbyFailure` (`NetworkError` or `!navigator.onLine` → `offline`; `ApiError` with code `rate_limited` → `rate_limited`; anything else → `unavailable`).
  - `placeStatesOf(placeIds: string[]): Promise<Map<string, { saved: boolean; listIds: Set<string> }>>` (`saved` = a live `user_places` row; `listIds` = lists with a live `list_items` row for the place).
  - `savePlaceToList(input: { result: SearchResult; listId: string | null; newListName?: string }): Promise<string>`, resolving to the place id (`placeRowId(provider, externalId)`). `newListName` (non-blank) creates an own list and uses it; otherwise `listId` is used, `null` meaning no list.

- [ ] **Step 1: Write the failing tests.**
  - `nearby.test.ts`: `fetchNearby` requests the right path with both coordinates; `nearbyFailure` maps `NetworkError`→`offline`, `ApiError("rate_limited")`→`rate_limited`, a 502 `ApiError` and a plain `Error`→`unavailable`.
  - `placeState.test.ts` (use the user-database pattern of `data/writes.test.ts`): a saved place is `saved: true`; a soft-deleted `user_places` row is `saved: false`; a place only in a list has `saved: false` and that list in `listIds`; an unknown id is `saved: false` with no lists.
  - `saveFromMap.test.ts`: saving a new result writes the place, a live `user_places` row, a source, and (with `listId`) one `list_items` row; saving a place already saved writes no second `user_places` row; choosing a list the place is already in adds no second item; `listId: null` adds no item; `newListName: " Cafés "` creates one own list named `Cafés` (trimmed) holding the place; a blank `newListName` throws and creates nothing; a soft-deleted `user_places` row is restored.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/map/nearby.test.ts src/data` → FAIL.
- [ ] **Step 3: Implement** the three files as specified. `savePlaceToList` calls `savePlaceFromSearch` (it already returns early for a live `user_places` and restores a soft-deleted one), then `createList({ name, color: null })` when asked, then `addToList` unless `placeStatesOf` shows the list already holds the place.
- [ ] **Step 4: Run** the same command → PASS; `pnpm --filter @magomap/web typecheck`.
- [ ] **Step 5: Commit** `feat(web): look up nearby places and save one to a list`.

### Task 3: `onContextPress` on both maps

**Files:**
- Create: `apps/web/src/map/longPress.ts`, `apps/web/src/map/longPress.test.ts`
- Modify: `apps/web/src/map/MapAdapter.ts`, `apps/web/src/map/leafletAdapter.ts`, `apps/web/src/map/kakaoAdapter.ts`, and the fake adapters in the existing map tests so they still satisfy `MapAdapter`
- Test: `apps/web/src/map/leafletAdapter.test.ts`, `apps/web/src/map/kakaoAdapter.test.ts`

**Interfaces:**
- Produces (`MapAdapter.ts`): `export interface ContextPress { point: LatLng; at: { x: number; y: number } }` (`at` is in viewport pixels, for positioning the popover) and, on `MapAdapter`, `onContextPress(cb: (press: ContextPress) => void): void`.
- Produces (`longPress.ts`): `export const LONG_PRESS_MS = 500`, `LONG_PRESS_SLOP_PX = 10`, and `export function watchLongPress(el: HTMLElement, onPress: (client: { x: number; y: number }) => void): () => void` (returns a cleanup). It fires once after `LONG_PRESS_MS` of a single finger held within `LONG_PRESS_SLOP_PX`; it never fires after a move beyond the slop, a second finger, `touchend`/`touchcancel`, or before the time.

- [ ] **Step 1: Write the failing tests.**
  - `longPress.test.ts` (fake timers, dispatched `TouchEvent`s): fires at 500 ms; not at 499 ms; not when the finger moves 11 px; fires when it moves 9 px; not with two touches; not after `touchend`; the cleanup removes the listeners.
  - `leafletAdapter.test.ts`: a `contextmenu` on the map calls the callback with the clicked `LatLng` and the event's client coordinates, and `preventDefault` is called on the DOM event.
  - `kakaoAdapter.test.ts`: the fake Kakao `event.addListener(map, "rightclick", …)` handler calls the callback with the event's `latLng`; the host element's DOM `contextmenu` is default-prevented; a long-press on the host calls the callback with the point from the map's projection for that pixel.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/map` → FAIL.
- [ ] **Step 3: Implement** `watchLongPress` in `longPress.ts` (touch events, passive listeners).
- [ ] **Step 4: Implement `onContextPress`** in both adapters. Leaflet: `map.on("contextmenu", e => cb({ point: e.latlng, at: { x: e.originalEvent.clientX, y: e.originalEvent.clientY } }))`, plus `watchLongPress(el, …)` converting the client pixel with `map.mouseEventToLatLng`-style arithmetic against the container's bounds. Kakao: the `rightclick` event (extend the local `event.addListener` typing to pass the mouse event), plus `watchLongPress(el, …)` using `map.getProjection().coordsFromContainerPoint`. Both suppress the host's DOM `contextmenu` default. The callback is stored like `onSelect`'s, so `swapAdapter` needs no change (`MapView` registers it per adapter in Task 4); `destroy()` removes the listeners.
- [ ] **Step 5: Run** `pnpm --filter @magomap/web exec vitest run src/map` and `pnpm --filter @magomap/web typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(web): maps report a right-click or long-press`.

### Task 4: The menu, the wiring, the strings and the e2e

**Files:**
- Create: `apps/web/src/map/MapContextMenu.tsx`, `apps/web/src/map/MapContextMenu.test.tsx`, `apps/web/e2e/save-from-map.spec.ts`
- Modify: `apps/web/src/map/MapView.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ko.json`, the styles file the map components use (find where `mm-sheet` and `mm-mapview` are styled)
- Test: `apps/web/src/map/MapContextMenu.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3 (`fetchNearby`, `nearbyFailure`, `placeStatesOf`, `savePlaceToList`, `ContextPress`, `adapter.onContextPress`); `Sheet` from `../components/Sheet`; `useLayout`; `useLocation` (wouter) for navigation.
- Produces: `MapContextMenu({ press, onClose }: { press: ContextPress; onClose: () => void })`. It looks up `press.point`, shows step one (loading, the rows, "none", or a failure message), then step two (own lists with "already in" marks, "No list", "New list" with a name field, and a Save button), saves, navigates to `/places/<encodeURIComponent(id)>` and calls `onClose`. A popover anchored at `press.at` on desktop, `Sheet` on phones. A newer `press` prop replaces the menu and ignores any older lookup's answer. Escape and a press outside close it and return focus to where it was.
- `MapView` keeps `press` state, registers `adapter.onContextPress(setPress)` when the adapter changes, and opens the menu at the map's centre on `ContextMenu` / `Shift+F10` from the canvas (the canvas gets `tabIndex={0}` and an accessible name if it isn't focusable already).

- [ ] **Step 1: Write the failing tests** (`MapContextMenu.test.tsx`, with `fetchNearby` and the data functions mocked):
  - `shows looking, then the rows with name, category, address and distance`;
  - `shows "No Kakao place found here" for an empty answer`;
  - `shows the offline, rate-limited and unavailable messages and saves nothing`;
  - `a place she already saved is marked saved, and step two marks the lists she is in`;
  - `saving calls savePlaceToList with the chosen list, then navigates to the place`; `No list` passes `listId: null`; `New list` passes the trimmed name;
  - `the save button is disabled for a blank new-list name`;
  - `a newer press replaces the menu and a late answer for the older one is ignored`;
  - `Escape closes it and returns focus`.
- [ ] **Step 2: Run** `pnpm --filter @magomap/web exec vitest run src/map/MapContextMenu.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `MapContextMenu.tsx` with the strings below (all under `map.save.*`; the builder adds any further key the same way):

  | key | en | ko |
  |---|---|---|
  | `title` | Save a place here | 여기 장소 저장 |
  | `looking` | Looking for places nearby… | 주변 장소를 찾는 중… |
  | `none` | No Kakao place found here. | 여기에서 카카오 장소를 찾지 못했어요. |
  | `offline` | Looking for places needs a connection. | 장소를 찾으려면 인터넷 연결이 필요해요. |
  | `rateLimited` | That's a lot of lookups. Wait a moment, then try again. | 조회가 너무 많아요. 잠시 후 다시 시도해 주세요. |
  | `unavailable` | Place lookup isn't available right now. | 지금은 장소를 조회할 수 없어요. |
  | `distance` | {{m}} m | {{m}}m |
  | `saved` | Saved | 저장됨 |
  | `chooseList` | Save to… | 저장할 리스트 |
  | `noList` | No list | 리스트 없이 |
  | `newList` | New list | 새 리스트 |
  | `newListName` | List name | 리스트 이름 |
  | `alreadyIn` | Already in | 이미 있음 |
  | `confirm` | Save | 저장 |
  | `saving` | Saving… | 저장하는 중… |
  | `saveFailed` | Couldn't save this place. Try again. | 이 장소를 저장하지 못했어요. 다시 시도해 주세요. |

- [ ] **Step 4: Wire `MapView`** as specified, and add the styles (popover, rows, list step) using existing brand variables, both themes.
- [ ] **Step 5: Write `save-from-map.spec.ts`** (projects `phone` and `desktop`; `page.route("**/api/search/nearby*", …)` answers a signed-looking result; sign in with `devLogin`, as `place.spec.ts` does): desktop right-click on the map opens the menu with the result, choosing it and an own list opens `/places/<id>` with the place in that list; phone long-press (dispatched touch events held 600 ms) does the same in a sheet; a normal tap on the map opens nothing; with the route answering `{ results: [] }` the "none" message shows and nothing is saved.
- [ ] **Step 6: Run** `pnpm --filter @magomap/web exec vitest run`, `pnpm --filter @magomap/web typecheck`, and `pnpm --filter @magomap/web exec playwright test e2e/save-from-map.spec.ts` → PASS.
- [ ] **Step 7: Commit** `feat(web): save a place from the map with a right-click or long-press`. Save screenshots of both layouts, both themes, for the UI review.
