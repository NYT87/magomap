// Leaflet + OpenStreetMap: the fallback map. https://leafletjs.com/reference.html

import type * as Leaflet from "leaflet";
import { PLACE_ZOOM, wellInside } from "./applyFocus";
import { watchLongPress } from "./longPress";
import type { ContextPress, LatLng, MapAdapter, MapMarker } from "./MapAdapter";
import { HIT, markerHtml } from "./markerHtml";

let leafletModule: Promise<typeof import("leaflet")> | null = null;

/** Starts downloading Leaflet early (before the config and data arrive); safe to call often. */
export function preloadLeaflet() {
  leafletModule ??= import("leaflet");
  return leafletModule;
}

export function createLeafletAdapter(): MapAdapter {
  let L: typeof Leaflet | null = null;
  let map: Leaflet.Map | null = null;
  let cluster: Leaflet.MarkerClusterGroup | null = null;
  let loose: Leaflet.LayerGroup | null = null;
  let me: Leaflet.Marker | null = null;
  let select: (id: string) => void = () => {};
  let viewChange: () => void = () => {};
  let contextPress: (press: ContextPress) => void = () => {};
  let stopLongPress: (() => void) | null = null;
  const noBrowserMenu = (e: Event) => e.preventDefault();
  let zoom = 10;
  let destroyed = false;
  let host: HTMLElement | null = null;
  let myLoc: LatLng | null = null;
  let pending: MapMarker[] | null = null;
  let pendingFit: LatLng[] | null = null;
  let center: LatLng = { lat: 0, lng: 0 };
  let tiles: Leaflet.TileLayer | null = null;
  let tileTimer: ReturnType<typeof setTimeout> | undefined;
  const addTiles = () => {
    clearTimeout(tileTimer);
    if (map && tiles && !map.hasLayer(tiles)) tiles.addTo(map);
  };

  const draw = (markers: MapMarker[]) => {
    if (!L || !cluster || !loose) {
      pending = markers;
      return;
    }
    cluster.clearLayers();
    loose.clearLayers();
    for (const m of markers) {
      const marker = L.marker([m.position.lat, m.position.lng], {
        title: m.label,
        alt: m.label,
        keyboard: true,
        icon: L.divIcon({
          className: `mm-pin-host mm-pin-host--${m.kind}`,
          html: markerHtml(m),
          iconSize: [HIT, HIT],
          iconAnchor: m.kind === "search" ? [HIT / 2, HIT / 2] : [HIT / 2, HIT - 2],
        }),
        opacity: 1,
        // The open place stays above every other pin, whatever their latitude.
        ...(m.selected ? { zIndexOffset: 1000 } : {}),
      });
      marker.on("click keypress", () => select(m.id));
      (m.kind === "search" || m.selected ? loose : cluster).addLayer(marker);
    }
  };

  const fitView = (points: LatLng[]) => {
    if (points.length === 0) return;
    if (!map || !L) {
      pendingFit = points;
      return;
    }
    if (points.length === 1) {
      const p = points[0] as LatLng;
      map.setView([p.lat, p.lng], PLACE_ZOOM, { animate: false });
    } else {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
        padding: [48, 48],
        maxZoom: 16,
        animate: false,
      });
    }
    addTiles();
  };

  const drawMe = (p: LatLng) => {
    if (!map || !L) return;
    me?.remove();
    me = L.marker([p.lat, p.lng], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: "", html: '<span class="mm-me"></span>', iconSize: [18, 18] }),
    }).addTo(map);
  };

  return {
    provider: "leaflet",
    mount(el, view) {
      host = el;
      center = view.center;
      zoom = view.zoom;
      el.addEventListener("contextmenu", noBrowserMenu);
      stopLongPress = watchLongPress(el, (client) => {
        if (!map || !L) return;
        const box = el.getBoundingClientRect();
        const p = map.containerPointToLatLng(
          L.point(client.x - box.left - el.clientLeft, client.y - box.top - el.clientTop),
        );
        contextPress({ point: { lat: p.lat, lng: p.lng }, at: client });
      });
      void (async () => {
        const mod = await preloadLeaflet();
        L = ((mod as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
        (globalThis as { L?: typeof Leaflet }).L = L;
        await import("leaflet.markercluster");
        await import("leaflet/dist/leaflet.css");
        await import("leaflet.markercluster/dist/MarkerCluster.css");
        // Replaced by another map while Leaflet was still loading: don't draw into its place.
        if (destroyed) return;
        // Phones pinch to zoom; desktop gets the buttons, away from the search bar.
        const desktop = window.matchMedia("(min-width: 768px)").matches;
        // maxZoom here: the clusters need it before the (deferred) tile layer brings one.
        map = L.map(el, { zoomControl: false, attributionControl: true, maxZoom: 19 }).setView(
          [view.center.lat, view.center.lng],
          view.zoom,
        );
        if (desktop) L.control.zoom({ position: "bottomright" }).addTo(map);
        // "moveend" fires once a drag, zoom or fit has finished.
        map.on("moveend", () => viewChange());
        // A right-click on the map (a touch's long-press is watched above, on its own).
        map.on("contextmenu", (e) =>
          contextPress({
            point: { lat: e.latlng.lat, lng: e.latlng.lng },
            at: { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
          }),
        );
        tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          crossOrigin: true,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        });
        // Tiles load once the first real view is known, so the default view's tiles aren't fetched.
        tileTimer = setTimeout(addTiles, 600);
        cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48 });
        loose = L.layerGroup();
        map.addLayer(cluster);
        map.addLayer(loose);
        if (pending) draw(pending);
        pending = null;
        if (myLoc) drawMe(myLoc);
        // Cleared before fitting: the fit fires "moveend" at once, and a switch it triggers
        // must not see this fit as still waiting (it would be done twice).
        const fit = pendingFit;
        pendingFit = null;
        if (fit) fitView(fit);
      })();
    },
    setMarkers: draw,
    fitTo(points) {
      fitView(points);
    },
    panTo(p) {
      map?.panTo([p.lat, p.lng]);
    },
    isWellInView(p) {
      if (!map) return false;
      const b = map.getBounds();
      return wellInside(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        p,
      );
    },
    getCenter() {
      if (!map) return center;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    getZoom() {
      return map ? map.getZoom() : zoom;
    },
    onSelect(cb) {
      select = cb;
    },
    onViewChange(cb) {
      viewChange = cb;
    },
    onContextPress(cb) {
      contextPress = cb;
    },
    showMyLocation(p, opts = {}) {
      myLoc = p;
      if (!map || !L) {
        // Still loading: the dot is drawn on mount, and the move waits with the other fits.
        if (opts.recenter !== false) pendingFit = [p];
        return;
      }
      drawMe(p);
      if (opts.recenter !== false) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    },
    pendingFit() {
      return pendingFit;
    },
    myLocation() {
      return myLoc;
    },
    destroy() {
      destroyed = true;
      clearTimeout(tileTimer);
      viewChange = () => {};
      contextPress = () => {};
      stopLongPress?.();
      stopLongPress = null;
      host?.removeEventListener("contextmenu", noBrowserMenu);
      map?.remove();
      map = null;
      // Leaflet leaves its classes and leftovers on the container: clear them for the next map.
      if (host) {
        host.classList.remove(...[...host.classList].filter((c) => c.startsWith("leaflet-")));
        host.replaceChildren();
        host = null;
      }
    },
  };
}
