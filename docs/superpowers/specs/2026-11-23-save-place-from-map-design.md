# Save a place from the map — design

Agreed with the owner on 2026-11-23, in a brainstorm. Size: a project (a server endpoint, two map adapters, a menu, a save flow).

## Why

She finds places by looking at the map, not only by typing a name. On Kakao Map she clicks a place and gets a card with a bookmark button. In magomap a place can only be saved from the search box or a Kakao import, so a place she sees on the map and can't name (or can't find by search) can't be saved. She wants to right-click a place on the map, choose to save it, say which list it goes in, and land on the place's details page to add notes and links.

## What she wants

1. Right-click on the map (long-press on a phone) opens a menu.
2. The menu lists the Kakao places nearest the click. She picks one.
3. A second step asks which of her own lists to save it to (or no list, or a new list).
4. It saves, and magomap opens that place's details page (notes, links).

## Goals

- Saving a real Kakao place from the map takes two taps after the right-click.
- The saved place is the same shared place as one saved from search or imported from a Kakao list: the same id (`p_kakao_<kakao place id>`), the same signed-source rule. Nothing about shared places changes.
- A place she already saved opens its details page instead of being saved again.
- Works on both maps (Kakao Maps and the OpenStreetMap fallback), desktop and phone.

## Non-goals

- **Places Kakao doesn't know** (a viewpoint, a parking spot, a bare address point, a Google-only place). They need a new kind of place owned by one user, because the shared places table only takes places Kakao has vouched for. That reverses the original "no manual places" rule. It is its own later task (B). Right-clicking where Kakao has nothing nearby shows "No Kakao place found here", and nothing is saved.
- **Adding a place to a Kakao list, and pushing that to Kakao Map.** Kakao lists are read-only in magomap except their notes, so only her own lists (`provider === null`) are offered. A write to Kakao needs an undocumented Kakao call nobody has captured yet, and only works through the extension on a computer, for lists she owns. A later task; the list step is built so a Kakao list can be offered later for a place that has a Kakao source.
- Rating, reviews and photo (the card in Kakao's own site). Kakao's public search doesn't return them.
- Clicking the map's own place labels. The Kakao map SDK doesn't expose them (not tested); the app searches around the click point instead.
- Offline use: it needs a connection, like search. Offline, the menu says so.

## Anti-goals (failure even if it "works")

- A place saved to the wrong list, or saved with no list when she chose one.
- A made-up or unsigned place reaching the shared table.
- A right-click (or long-press) that is slow, or also does something else: no browser context menu, no marker selection, no map drag, no accidental open on a normal tap or a pan.
- The nearest place not being the one she meant, with no way to see which is which.

## Approaches considered

- **A. Nearby Kakao places from Kakao's public Local search (chosen).** Reuses signing and the shared-place model. Limits: only places Kakao Local has; no rating or photo; the result is picked by distance, not by hitting the label.
- B. A, plus saving a bare address point for places Kakao doesn't know. Needs user-owned places and a reversal of "no manual places". Later.
- C. Kakao Map's private place card (`/api/v1/mapsearch/srcid`) for ratings and photos. Undocumented, blocked outside the Kakao Map page (`403 Gate Token Rejected`), extension-only. Not chosen.

She chose A, with B and Kakao-list writes as separate tasks.

## Design

**Server.** A new route `GET /api/search/nearby?lat=&lng=` (same auth as search: `requireUser`, and the same per-user rate limit, counted once per right-click). It asks Kakao Local, around the point with a radius of about 50 m sorted by distance, for places by category group (restaurants, cafés, shops, attractions, and so on), merges and de-duplicates them by Kakao place id, keeps the nearest few (about 8), and returns them as `{ results: [{ result, distanceM }] }`, where each `result` is the same signed `SearchResult` as `/search/places` (same `signSearchResult`) and `distanceM` is outside the signature, so `SearchResult`, search and import code don't change. A user can't reach the shared table without the signature, as today. Kakao Local has no "places at this point" call and no empty-keyword search, which is why it is one call per category group; the builder decides which groups, within a ceiling of **6 Kakao calls per press**, made in parallel (the radius, the result count and the ceiling are constants in one place). Failures answer like search does (`search_unavailable` 502, `rate_limited` 429).

**Map adapters.** `MapAdapter` gets `onContextPress(cb: (point: LatLng, at: {x: number, y: number}) => void)`: right-click on desktop, long-press on a phone. Leaflet has a `contextmenu` event (it also fires on a long touch). Kakao Maps has a `rightclick` event; a long-press on its map is built from touch events. In both, the browser's own context menu is suppressed on the map, and a drag or pinch never counts as a press.

**Menu and flow (web).** On a press, a small popover opens at the pressed spot on desktop, and a bottom sheet on the phone (the app's existing sheet pattern). It shows "Looking…", then the nearby places (name, category, distance), or "No Kakao place found here", or "Needs a connection". Picking one goes to step two: her own lists, "No list", and "New list" (a name field; `createList`). Confirming runs `savePlaceFromSearch(result)`, then `addToList(listId, placeId)` when a list was chosen, then navigates to `/places/<id>` (the details page, side panel on desktop, sheet on phone). Pressing elsewhere or Escape closes the menu.

**A place she already has.** Step two is always shown, so she can still add it to a list. On confirm: the save is skipped when `user_places` already holds it live; the add is skipped when she is already in the chosen list; "No list" on a saved place changes nothing. Then it goes to the details page. In step two, the lists she is already in are marked "already in". The client works this out locally from the place id `p_kakao_<id>` (her data is on the device); the route doesn't read the database. A place she once removed (a soft-deleted `user_places` row) counts as not saved, and saving it again restores it, as `savePlaceFromSearch` does today.

**Telling candidates apart.** Each row shows name, category, the road address (or address) and the distance, so two cafés 20 m apart can be told apart. The map doesn't highlight candidates in this version.

**Provider-neutral on purpose.** The menu, the list step and the save call take a result with a provider and an external id, not "Kakao" specifically. A place can already have several sources (`place_sources`), and a place's sources decide which kinds of list it can join. Own lists take any place. Kakao lists will take a place that has a Kakao source, once writing to Kakao exists.

## Constraints

- The Kakao REST key stays on the server; the app never calls Kakao Local directly.
- Cloudflare Free plan: a request's sub-requests are limited, and so is the Kakao Local quota. One right-click must stay well within both.
- The shared-places rule (signed sources only) is unchanged.
- Accessibility: the menu is reachable and operable by keyboard (a way to open it without a mouse, for example a key on the focused map), has labelled options, and returns focus when closed. Korean and English strings.
- Works in light and dark themes, as the rest of the app.

## Calls made after a reader checked this design

- The flow's writes are all local (IndexedDB, queued to sync like every other change), so only the nearby lookup needs a connection. The order is: save the place, create the new list when asked, add to the list, open the details page. A failure in a local write shows an error and stops; nothing is left half-way in a way that needs a server.
- The ceiling of 6 calls per press is my choice. It stays far under the Worker's sub-request limit; the Kakao Local daily quota wasn't looked up, and at two users it isn't a concern.

## Left to the builder

- Which Kakao category groups to query, the radius, and how many results to show (starting point: about 50 m, 8 results).
- The exact popover and sheet visuals, within the brand guidelines.
- How long a long-press is, and how the keyboard opens the menu.
- Whether the menu marks the nearest place as the suggested one.

## Done when

- Right-click on either map near a Kakao place opens the menu with that place first; picking it and a list saves it and opens its details page, with the place in that list.
- The same place found through search is one row, not two.
- Nothing nearby, offline, rate-limited and a Kakao failure each show a clear message and save nothing.
- A normal click on a marker, a drag, and a pinch don't open the menu.
- Tests cover the nearby route (signing, de-duplication, ordering, errors), the menu flow (including already-saved and "no list"), and each adapter's press event.
