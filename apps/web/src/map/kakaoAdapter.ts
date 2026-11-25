// Kakao Maps JS SDK. https://apis.map.kakao.com/web/documentation/
import { PLACE_ZOOM, wellInside } from "./applyFocus";
import { watchLongPress } from "./longPress";
import type { ContextPress, LatLng, MapAdapter, MapMarker } from "./MapAdapter";
import { markerHtml } from "./markerHtml";

// A minimal typing of the parts of the SDK we use.
interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}
interface KakaoPoint {
  x: number;
  y: number;
}
/** What a map mouse event (such as "rightclick") passes: the point on the map and in the box. */
interface KakaoMouseEvent {
  latLng: KakaoLatLng;
  point: KakaoPoint;
}
interface KakaoMaps {
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Point: new (x: number, y: number) => KakaoPoint;
  LatLngBounds: new () => { extend(p: KakaoLatLng): void };
  Map: new (
    el: HTMLElement,
    opts: { center: KakaoLatLng; level: number; keyboardShortcuts?: boolean },
  ) => {
    setCenter(p: KakaoLatLng): void;
    panTo(p: KakaoLatLng): void;
    setLevel(l: number): void;
    getLevel(): number;
    getCenter(): KakaoLatLng;
    setBounds(b: unknown): void;
    getBounds(): { getSouthWest(): KakaoLatLng; getNorthEast(): KakaoLatLng };
    relayout(): void;
    getProjection(): { coordsFromContainerPoint(p: KakaoPoint): KakaoLatLng };
  };
  CustomOverlay: new (opts: {
    position: KakaoLatLng;
    content: HTMLElement;
    yAnchor?: number;
    xAnchor?: number;
    zIndex?: number;
    map?: unknown;
  }) => { setMap(m: unknown): void };
  event: {
    addListener(target: unknown, type: "rightclick", cb: (e: KakaoMouseEvent) => void): void;
    addListener(target: unknown, type: string, cb: () => void): void;
  };
  MarkerClusterer: new (opts: {
    map: unknown;
    averageCenter?: boolean;
    minLevel?: number;
  }) => { addMarkers(ms: unknown[]): void; clear(): void };
}

export const kakaoMaps = () => (window as unknown as { kakao: { maps: KakaoMaps } }).kakao.maps;

/** Leaflet-style zoom (0–19) to Kakao level (1 is closest, 14 farthest). */
export const kakaoLevel = (zoom: number) => Math.min(14, Math.max(1, 20 - zoom));
/** Kakao level back to Leaflet-style zoom. */
export const zoomFromKakaoLevel = (level: number) => 20 - level;

const SELECTED_Z = 10;

export function createKakaoAdapter(): MapAdapter {
  const k = kakaoMaps();
  let map: InstanceType<KakaoMaps["Map"]> | null = null;
  let cluster: InstanceType<KakaoMaps["MarkerClusterer"]> | null = null;
  let loose: { setMap(m: unknown): void }[] = [];
  let me: { setMap(m: unknown): void } | null = null;
  let select: (id: string) => void = () => {};
  let viewChange: () => void = () => {};
  let contextPress: (press: ContextPress) => void = () => {};
  let stopLongPress: (() => void) | null = null;
  const noBrowserMenu = (e: Event) => e.preventDefault();
  let host: HTMLElement | null = null;
  let myLoc: LatLng | null = null;

  const overlay = (m: MapMarker) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `mm-pin-host mm-pin-host--${m.kind}`;
    el.setAttribute("aria-label", m.label);
    el.innerHTML = markerHtml(m);
    el.addEventListener("click", () => select(m.id));
    return new k.CustomOverlay({
      position: new k.LatLng(m.position.lat, m.position.lng),
      content: el,
      yAnchor: m.kind === "search" ? 0.5 : 1,
      // The open place is drawn above every other pin.
      ...(m.selected ? { zIndex: SELECTED_Z } : {}),
    });
  };

  return {
    provider: "kakao",
    mount(el, view) {
      host = el;
      map = new k.Map(el, {
        center: new k.LatLng(view.center.lat, view.center.lng),
        level: kakaoLevel(view.zoom),
        // Arrows move the map, + and - zoom, while focus is on the map (as on Leaflet's map).
        // Off by default: https://apis.map.kakao.com/web/documentation/#MapOptions
        keyboardShortcuts: true,
      });
      cluster = new k.MarkerClusterer({ map, averageCenter: true, minLevel: 7 });
      // "idle" fires once the map has stopped moving, not while dragging.
      k.event.addListener(map, "idle", () => viewChange());
      // https://apis.map.kakao.com/web/documentation/#Map_rightclick
      k.event.addListener(map, "rightclick", (e) => {
        const box = el.getBoundingClientRect();
        contextPress({
          point: { lat: e.latLng.getLat(), lng: e.latLng.getLng() },
          at: { x: box.left + e.point.x, y: box.top + e.point.y },
        });
      });
      // Focusable, as Leaflet makes its map: the keyboard opens the save menu from here.
      if (el.tabIndex < 0) el.tabIndex = 0;
      el.addEventListener("contextmenu", noBrowserMenu);
      stopLongPress = watchLongPress(el, (client) => {
        if (!map) return;
        const box = el.getBoundingClientRect();
        const p = map
          .getProjection()
          .coordsFromContainerPoint(new k.Point(client.x - box.left, client.y - box.top));
        contextPress({ point: { lat: p.getLat(), lng: p.getLng() }, at: client });
      });
    },
    setMarkers(markers) {
      if (!map || !cluster) return;
      cluster.clear();
      for (const o of loose) o.setMap(null);
      loose = [];
      const clustered = [];
      for (const m of markers) {
        const o = overlay(m);
        if (m.kind === "search" || m.selected) {
          o.setMap(map);
          loose.push(o);
        } else clustered.push(o);
      }
      cluster.addMarkers(clustered);
    },
    fitTo(points) {
      if (!map || points.length === 0) return;
      if (points.length === 1) {
        const p = points[0] as LatLng;
        map.setCenter(new k.LatLng(p.lat, p.lng));
        map.setLevel(20 - PLACE_ZOOM);
        return;
      }
      const b = new k.LatLngBounds();
      for (const p of points) b.extend(new k.LatLng(p.lat, p.lng));
      map.setBounds(b);
    },
    panTo(p) {
      map?.panTo(new k.LatLng(p.lat, p.lng));
    },
    isWellInView(p) {
      const b = map?.getBounds();
      if (!b) return false;
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      return wellInside(
        { south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() },
        p,
      );
    },
    getCenter() {
      const c = map?.getCenter();
      return c ? { lat: c.getLat(), lng: c.getLng() } : { lat: 0, lng: 0 };
    },
    getZoom() {
      return map ? zoomFromKakaoLevel(map.getLevel()) : 10;
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
      if (!map) return;
      me?.setMap(null);
      const dot = document.createElement("span");
      dot.className = "mm-me";
      me = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: dot, map });
      if (opts.recenter !== false) map.panTo(new k.LatLng(p.lat, p.lng));
    },
    pendingFit() {
      // Kakao draws as soon as it's mounted: nothing ever waits.
      return null;
    },
    myLocation() {
      return myLoc;
    },
    destroy() {
      cluster?.clear();
      map = null;
      viewChange = () => {};
      contextPress = () => {};
      stopLongPress?.();
      stopLongPress = null;
      host?.removeEventListener("contextmenu", noBrowserMenu);
      // Kakao leaves its own elements behind: clear them so another map can mount here.
      host?.replaceChildren();
      host = null;
    },
  };
}
