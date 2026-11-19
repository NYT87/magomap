<p align="center">
  <img src="assets/banners/launch/ink-1280x400.png" alt="magomap: Shape your own map." width="100%">
</p>

# magomap

**Shape your own map.** magomap is a map app you install on your phone. Save the places you love, keep a diary of every visit, collect links about them, and group them into lists. Everything works offline, so you can write a note while standing at the place, even with bad signal.

> [!NOTE]
> **Status:** the backend (sign-in, offline sync, Kakao import, place search) is built and tested; the app itself is next. See [the design](docs/superpowers/specs/2026-11-19-magomap-design.md) and [the implementation plans](docs/superpowers/plans/).

## The name

**Mago (마고)** comes from **Mago Halmi (마고할미)**, the giant creation goddess of Korean mythology, who sculpted the earth's mountains, rivers and islands. magomap borrows her story for a map-centred app in which each person shapes their own personal geography: the places they keep, and what they remember about them.

The logo shows two hand-shaped peaks, the land Mago sculpted, whose outline forms a quiet "m". A pin sits on the summit, marking a place that is yours.

## What it does

- **A map of your places.** Search the map with Kakao place search and save places.
- **A visit diary.** Add a new, dated note every time you visit, and read back your earlier impressions.
- **Links.** Save articles, menus or posts to a place.
- **Lists.** Like Google Maps lists, and a place can be in many lists. Its diary and links belong to the place, so they're the same in every list.
- **Kakao Map import.** Bring in your Kakao Map lists through [kakao-list](https://github.com/NYT87/kakao-list), and keep them following Kakao. Your own notes are never touched by an import.
- **Location history.** When a place moves, magomap keeps its earlier locations, and shows them on the map and beside older diary entries.
- **Offline first.** Browse, search and write without a connection. Changes sync when you're back online.
- **Korean and English**, with layouts for phone and desktop.

## Built with

- A Cloudflare Worker serves the API and the app.
- The database is D1 (SQLite) or Postgres, chosen by whoever deploys it.
- The PWA is React, with an offline store in the browser.
- The map is the Kakao Maps SDK, with an OpenStreetMap fallback.

## Development

You'll need Node 22, pnpm and Docker (Docker is only for the Postgres tests).

```bash
pnpm install
docker compose up -d postgres
TEST_DATABASE_URL=postgres://magomap:magomap@localhost:5432/magomap_test scripts/gate.sh
```

`scripts/gate.sh` runs every check: Biome, typecheck, the tests on SQLite, Postgres and the Workers runtime, and the build. It also refuses changes that lower the quality bar. [docs/superpowers/build-process.md](docs/superpowers/build-process.md) describes how changes are built and reviewed.

To run the API locally with sample data, see "Local development" in [docs/deploy.md](docs/deploy.md).

## Deployment

See [docs/deploy.md](docs/deploy.md). It covers D1 or Postgres, the Kakao Developers setup, secrets, and rollback.

## Brand

The colours, type, voice and logo are in [docs/brand-guidelines.md](docs/brand-guidelines.md). The logo files and app icons are in [`assets/brand/`](assets/brand/), and the banners are in [`assets/banners/launch/`](assets/banners/launch/).

---

<sub>magomap is an independent project. It is not made by, affiliated with, or endorsed by Kakao. Kakao and Kakao Map are trademarks of their respective owners.</sub>
