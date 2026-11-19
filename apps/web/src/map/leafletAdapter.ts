// Leaflet + OpenStreetMap: the fallback map. https://leafletjs.com/reference.html
import type * as Leaflet from "leaflet";
import type { LatLng, MapAdapter, MapMarker } from "./MapAdapter";
import { markerHtml, pinSize } from "./markerHtml";

export function createLeafletAdapter(): MapAdapter {
  let L: typeof Leaflet | null = null;
  let map: Leaflet.Map | null = null;
  let cluster: Leaflet.MarkerClusterGroup | null = null;
  let loose: Leaflet.LayerGroup | null = null;
  let me: Leaflet.CircleMarker | null = null;
  let select: (id: string) => void = () => {};
  let pending: MapMarker[] | null = null;
  let pendingFit: LatLng[] | null = null;
  let center: LatLng = { lat: 0, lng: 0 };

  const draw = (markers: MapMarker[]) => {
    if (!L || !cluster || !loose) {
      pending = markers;
      return;
    }
    cluster.clearLayers();
    loose.clearLayers();
    for (const m of markers) {
      const size = pinSize(m);
      const marker = L.marker([m.position.lat, m.position.lng], {
        title: m.label,
        alt: m.label,
        keyboard: true,
        icon: L.divIcon({
          className: "mm-pin-host",
          html: markerHtml(m),
          iconSize: [size, size],
          iconAnchor: m.kind === "search" ? [size / 2, size / 2] : [size / 2, size - 2],
        }),
        opacity: 1,
      });
      marker.on("click keypress", () => select(m.id));
      (m.kind === "search" ? loose : cluster).addLayer(marker);
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
      map.setView([p.lat, p.lng], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
      padding: [48, 48],
      maxZoom: 16,
    });
  };

  return {
    provider: "leaflet",
    mount(el, view) {
      center = view.center;
      void (async () => {
        const mod = await import("leaflet");
        L = (mod.default ?? mod) as typeof Leaflet;
        (globalThis as { L?: typeof Leaflet }).L = L;
        await import("leaflet.markercluster");
        await import("leaflet/dist/leaflet.css");
        await import("leaflet.markercluster/dist/MarkerCluster.css");
        // Phones pinch to zoom; desktop gets the buttons, away from the search bar.
        const desktop = window.matchMedia("(min-width: 768px)").matches;
        map = L.map(el, { zoomControl: false, attributionControl: true }).setView(
          [view.center.lat, view.center.lng],
          view.zoom,
        );
        if (desktop) L.control.zoom({ position: "bottomright" }).addTo(map);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          crossOrigin: true,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48 });
        loose = L.layerGroup();
        map.addLayer(cluster);
        map.addLayer(loose);
        if (pending) draw(pending);
        pending = null;
        if (pendingFit) fitView(pendingFit);
        pendingFit = null;
      })();
    },
    setMarkers: draw,
    fitTo(points) {
      fitView(points);
    },
    panTo(p) {
      map?.panTo([p.lat, p.lng]);
    },
    getCenter() {
      if (!map) return center;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    onSelect(cb) {
      select = cb;
    },
    showMyLocation(p) {
      if (!map || !L) return;
      me?.remove();
      me = L.circleMarker([p.lat, p.lng], {
        radius: 8,
        color: "#FBF8F2",
        weight: 3,
        fillColor: "#2F6FA3",
        fillOpacity: 1,
      }).addTo(map);
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    },
    destroy() {
      map?.remove();
      map = null;
    },
  };
}
