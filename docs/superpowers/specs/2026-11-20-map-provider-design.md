# Map provider: Automatic, Kakao or OpenStreetMap — short design

Change to the magomap PWA (apps/web), agreed with the owner on 2026-11-20.

## Why

Kakao Map only has detail inside Korea; abroad it shows a plain map. To plan a trip outside Korea she needs a map with real streets. magomap already ships OpenStreetMap (Leaflet), but uses it only when Kakao fails to load.

## Goals

1. **Account** gets a **Map** setting with three choices: **Automatic** (default), **Kakao Map**, **OpenStreetMap**.
   - ko: 지도 — 자동 / 카카오맵 / OpenStreetMap; en: Map — Automatic / Kakao Map / OpenStreetMap.
   - A one-line hint under it: "Automatic uses Kakao Map in Korea and OpenStreetMap elsewhere."
2. **Automatic** shows Kakao Map while the map is centred in Korea and OpenStreetMap once the centre moves outside it, and back again. It doesn't flicker at the edge:
   - it switches to OpenStreetMap only when the centre leaves an **outer** box around Korea;
   - it switches back to Kakao only when the centre enters an **inner** box.
3. On a switch the map keeps **the same centre and about the same zoom**, keeps markers, the list visibility and the selected place, and redraws once.
4. **Kakao Map** and **OpenStreetMap** force that provider everywhere.
5. When Kakao can't load (no key, SDK blocked, offline at start), the map uses OpenStreetMap whatever the setting, as today, and the setting shows a short note that Kakao isn't available right now.
6. The "Map by …" caption keeps naming the provider in use.

## Non-goals

- Other providers (Google, Naver, Apple, Mapbox): they need paid keys or other accounts.
- Syncing the setting between devices: it lives with the other map preferences (per account, per device, `mapPrefs`).
- Offline map tiles.

## Anti-goals

- A map that flips back and forth while panning near the border.
- Losing her place (centre, zoom, open place) when it switches.

## Approaches

1. Automatic only — rejected: no way to force a provider (e.g. to compare, or when Kakao misbehaves).
2. Setting only — rejected: she'd have to remember to switch before and after every trip.
3. **Chosen (owner's pick): both** — a setting whose default is Automatic.

## Decided

- Korea boxes (latitude/longitude of the map centre):
  - inner: 33.0–38.7°N, 124.5–131.0°E;
  - outer: 32.0–39.5°N, 123.5–132.0°E (the inner box plus a margin; Dokdo at 131.87°E stays Kakao).
- Zoom carries across through one conversion between Kakao levels and Leaflet zoom, kept in one place, so a round trip returns to the same zoom.
- The provider in use is decided at load from the saved setting and the starting centre, then re-checked when the user stops moving the map (not on every frame).

## Left to the builder

- How the adapters expose view changes and zoom (for example `getZoom()` and `onViewChange(cb)` added to `MapAdapter`), and how `MapView` swaps adapters without remounting the rest of the screen.
- Whether the Kakao SDK, once loaded, stays loaded while OpenStreetMap is showing (it should not be reloaded on every switch).
- Tests: the box rule with its margin as a pure function; a component test for the setting; an e2e check that panning to Tokyo shows OpenStreetMap and back to Seoul shows Kakao, where Kakao is available in the test environment, or with the adapter loader stubbed otherwise.
