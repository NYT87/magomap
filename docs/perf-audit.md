# Performance audit (plan 02, Task 7)

Run on 2026-11-19 against the production build served by a local Worker (`wrangler dev --env d1`), signed in, on the map screen. Auditor: the `auditor-performance` agent; the after-fix numbers were re-measured with its script.

**How it was measured.** Lighthouse wasn't installed, so there's no Lighthouse score. Lab numbers come from Playwright Chromium: 412×823 mobile viewport, CDP throttling (150 ms RTT, 1.6 Mbps down) and 4× CPU slowdown, with the service worker blocked for cold runs. FCP, LCP and TBT come from `PerformanceObserver`. These are one or two runs each, not a statistical sample. INP wasn't measured.

## Numbers

| Metric | Before | After | Target |
|---|---|---|---|
| Initial JS (gzip) | 177.7 kB | about the same | ≤ 200 kB |
| Initial CSS (gzip) | 20.0 kB | about the same | n/a |
| FCP | 1.54–1.56 s | 1.56 s | n/a |
| LCP | 4.24–4.42 s | 4.12–4.50 s | ≤ 2.5 s |
| TBT | 149–154 ms | 145–154 ms | n/a |
| CLS | 0 | 0.001 | ≤ 0.1 |
| Transferred, cold | about 550 KB, 29–41 requests | 395 KB, 21 requests | n/a |
| Map tile requests on start | 21 (z7 then z10) | 8 (one zoom) | n/a |
| Offline reload after a first visit | shell in 151 ms from the service worker | unchanged | no network wait |

Leaflet and markercluster stay out of the main chunk. Fonts are self-hosted, subset and `font-display: swap`. Only the subsets a page uses are fetched, and they're cached at runtime.

## Findings and what was done

- **High: LCP above target.** The LCP element is an OpenStreetMap tile. Two changes went in:
  - Leaflet now starts downloading as soon as the map mounts, without waiting for the config and data.
  - Tiles are added only once the first real view is known. Before, the default view's tiles were fetched and then thrown away.

  This cut tile requests from 21 to 8 and transfer by about 155 KB. LCP stays around 4.1–4.5 s on this throttled profile, because the remaining time is the download of external tiles at 1.6 Mbps.

  **Ruling:** accepted for now. Production uses the Kakao map when a key is set, and repeat visits start from the service worker and the tile cache.

  **Cost if wrong:** the first visit on a slow connection shows a blank map for a few seconds. Re-measure with Lighthouse once the app is deployed with the Kakao key.
- **Medium: tiles fetched at two zoom levels.** Fixed, as above.
- **Medium: main chunk 577 kB raw**, which triggers a bundler warning but is under the gzip budget. Deferred: split vendor code and lazy-load the non-map routes when the budget gets tight.
- **Low:** the OSM tile cache and the icon sizes are fine.

**Not measured:** a Lighthouse score, INP, Kakao SDK loading, marker cost with thousands of places, and sync page sizes.

## Re-audit, 2026-11-25 (go-live checklist, issue #64)

The `auditor-performance` run on `main` (same throttled phone profile, Leaflet/OSM path, mocked API) found the first JavaScript had grown to **245.5 kB gzip** (from 177.7 kB): `apps/web/src/lists/duplicateToKakao.ts` imported the WCONGNAMUL conversion statically, which pulled proj4 into the entry.

What was done:
- The conversion is imported only when a copy to Kakao Map runs: 241,778 → 198,572 bytes gzip (level 9).
- The pages beside or over the map (place details, lists, a list, account) load when first opened (`React.lazy` in `apps/web/src/routes.tsx`): 198,572 → **182,584 bytes**.
- **A build gate:** `apps/web/scripts/check-bundle.mjs` runs after `vite build` and fails the build when the scripts `index.html` loads first are over **200,000 bytes gzip**, so a static import like this one can't slip through again.
- Content-hashed files under `/assets/` are now served `Cache-Control: public, max-age=31536000, immutable` (`apps/web/public/_headers`); before, every asset was `max-age=0, must-revalidate`. `index.html`, `sw.js` and the manifest keep the default.

Still open:
- **LCP** was 4.5–4.6 s on the OSM path (the same as the earlier ruling). Production uses the Kakao map, which this lab run did not measure. Re-measure on the deployed Worker with Lighthouse (`npx lighthouse https://magomap.jmn8718.workers.dev --preset=perf --form-factor=mobile`) before ticking the checklist line. A preconnect to the OSM tile server was not added: it would only help the fallback.
- **Medium:** the library live query recomputes the whole map on any change (`useLibrary`, `useMapData`); check with a thousand-place fixture.
