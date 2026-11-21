# The selected place's pin stands out — design

Agreed with the owner on 2026-11-21 ("when a place is selected, and we see the description, the icon should change to be clear which place I selected"; option **a**). A small change.

## Why

When she opens a place's details, every pin on the map still looks the same, so she can't tell which one she's reading about. On a phone the details sheet covers part of the map, and when zoomed out the pin can sit inside a cluster, so it may not be visible at all.

## What changes

- **Selected** means the saved place whose details are open (`/places/<id>`), on phone and desktop. It stops being selected when the details close.
- **Look (option a):** the selected place's pin is **bigger** and has a **ring** around it, and keeps its **list colour**, so it is still recognisably that list's pin. No animation.
- **Never hidden:** the selected pin is **never clustered** and is drawn **above** every other pin, on both maps (Kakao Map and OpenStreetMap).
- **Accessible:** its label says it is the selected place (e.g. "바다정원 카페, selected" / Korean equivalent), so screen readers and the phone's place list can tell.
- Its previous-location pins, search pins and other saved pins are unchanged.

## Approaches considered

- **a. Bigger, with a ring, list colour kept** — chosen: clear at a glance and still says which list it belongs to.
- b. Accent colour — clear, but loses the list colour.
- c. Gentle pulse — eye-catching, but motion (needs reduce-motion handling) and busier.

## Constraints

- Same pin on both maps: the HTML/SVG pin in `apps/web/src/map/markerHtml.ts` is shared.
- Brand colours as CSS variables, both themes; the ring must stay visible on light and dark map tiles.
- Every marker stays a 44 px tap target.

## Left to the builder

- Exact sizes and the ring's colour and width, within the brand guidelines (checked by the UI review with screenshots, light and dark, phone and desktop).
- How the adapters keep one marker out of the cluster (Leaflet `markerClusterGroup`, Kakao `MarkerClusterer`).
- How the selected place id reaches the map (the place route is already known where the map lives).
