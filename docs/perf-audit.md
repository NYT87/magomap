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

## Lighthouse on production, 2026-11-25 (0.1.8, issue #64)

The owner ran Lighthouse 13.5 (Mobile, simulated throttling, signed in) on `https://magomap.jmn8718.workers.dev/`, with the Kakao map. The run had a password-manager extension (about 0.5 s of long tasks) and stored IndexedDB data, so it is somewhat pessimistic. Unthrottled, the page's largest paint came at about 0.95 s.

| | Score / value | Target |
|---|---|---|
| Performance | **26** | |
| Accessibility / Best Practices / SEO | 96 / 100 / 92 | |
| LCP | 6.5 s | ≤ 2.5 s |
| CLS | 0.40 | ≤ 0.1 |
| TBT | 1.8 s | ≤ 0.2 s |
| FCP / Speed Index | 2.6 s / 3.9 s | |

What it found, and what was done (branch `perf/lighthouse-fixes`):
- **CLS 0.40, all from the Kakao map's tiles.** The map opened at the default view (Jeju, zoom 10), drew its tiles, then jumped to fit the saved places once they loaded. The Kakao map positions its tiles with `left`/`top`, so the jump counts as a layout shift. The LCP element was one of those first tiles, which then got thrown away. The map now remembers where it settled after fitting (`src/map/mapFitMemo.ts`, per account: `mm.mapFit.<userId>`, removed with the account's other device keys) and opens there on the next visit. It fits again when the saved places' bounds change, on another map, in a box of another size (a turned phone), or when on the Kakao map the places aren't actually on screen. The first visit on a device still fits once. The fit is remembered right after it is made, before a place opened by its link moves the map.
- **TBT 1.8 s: one 0.77 s task** (≈1.5 s on the throttled CPU), mostly HTML parsing, style and layout. It came from building one Kakao overlay per place (~350), each parsed from an HTML string. Now each pin look is parsed once and copied (`markerElement`). Keeping overlays across redraws was tried and left out: the Kakao key refuses `localhost`, so how Kakao's clusterer treats a re-added overlay couldn't be checked.
- **Preconnect** to `dapi.kakao.com`, `t1.kakaocdn.net` and `mts.kakaocdn.net` (Lighthouse estimated ~0.3 s off LCP).
- **SEO: `robots.txt`** returned the app's HTML (the SPA fallback). There is now a real one, `Disallow: /`, because the app is private.

Not changed, and why:
- **Unused CSS (91% of 23 kB):** most of it is Pretendard's 92 `@font-face` subset rules plus `app.css` for screens that aren't open. Lighthouse puts the saving at ~150 ms. Splitting `app.css` by screen risks missing styles, so it is left for later.
- **Third-party only:** Kakao tile caching, formats and sizes; the clusterer's legacy JS; the Kakao logo link's small tap target (their attribution, not ours to change); unminified JS from the browser extension.

Re-run Lighthouse after this ships (incognito, so no extensions). Open the map once before measuring, so the remembered view applies.
