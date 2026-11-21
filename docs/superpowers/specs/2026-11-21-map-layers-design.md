# Map layers (Map / Skyview / Skyview + labels) — design

Agreed with the owner on 2026-11-21 (option **A**). A small change.

## Why

She plans trips in Kakao Map, where Skyview (satellite photos) helps her see the area around a place. magomap should feel like Kakao Map and offer the same layers. The "Map: Kakao Map / OpenStreetMap" label on the map isn't needed.

## What changes

- **A layers button** on the map, beside "my location", on phone and computer. It opens a small menu: **Map / Skyview / Skyview + labels** (지도 / 스카이뷰 / 스카이뷰 + 라벨).
- **On Kakao Map** these are Kakao's own map types (`ROADMAP`, `SKYVIEW`, `HYBRID`).
- **On OpenStreetMap** only "Map" is available; the other two are shown disabled with "Skyview is available on Kakao Map". In Korea, Automatic picks Kakao Map anyway.
- **Remembered per device**, like the map choice (`mm.mapLayer.<userId>`). If the map switches to OpenStreetMap, it shows the standard map; when it's back on Kakao Map, the saved layer returns.
- **The "Map: …" label goes.** OpenStreetMap's required "© OpenStreetMap contributors" credit stays.
- Pins, clusters and the selected pin are unchanged on every layer; they must stay readable on Skyview (photos are busy and dark).

## Approaches considered

- **A. Kakao's own layers; OpenStreetMap keeps its standard map** — chosen: the Kakao experience and Skyview where she plans, no new services or licences.
- B. Also satellite photos on OpenStreetMap from a third-party imagery service — Skyview outside Korea, but a new dependency with usage terms that limit production use or need an account and key.

## Left to the builder

- The icon and the menu's exact look (brand guidelines; 44 px targets; keyboard and screen reader: a menu button with radio items).
- Whether pins need a stronger outline on Skyview (judged from screenshots).
