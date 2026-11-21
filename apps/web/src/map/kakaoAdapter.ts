// Kakao Maps JS SDK. https://apis.map.kakao.com/web/documentation/
import type { LatLng, MapAdapter, MapMarker } from "./MapAdapter";
import { markerHtml } from "./markerHtml";

// A minimal typing of the parts of the SDK we use.
interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}
interface KakaoMaps {
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  LatLngBounds: new () => { extend(p: KakaoLatLng): void };
  Map: new (
    el: HTMLElement,
    opts: { center: KakaoLatLng; level: number },
  ) => {
    setCenter(p: KakaoLatLng): void;
    panTo(p: KakaoLatLng): void;
    setLevel(l: number): void;
    getLevel(): number;
    getCenter(): KakaoLatLng;
    setBounds(b: unknown): void;
    relayout(): void;
  };
  CustomOverlay: new (opts: {
    position: KakaoLatLng;
    content: HTMLElement;
    yAnchor?: number;
    xAnchor?: number;
    zIndex?: number;
    map?: unknown;
  }) => { setMap(m: unknown): void };
  event: { addListener(target: unknown, type: string, cb: () => void): void };
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
      });
      cluster = new k.MarkerClusterer({ map, averageCenter: true, minLevel: 7 });
      // "idle" fires once the map has stopped moving, not while dragging.
      k.event.addListener(map, "idle", () => viewChange());
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
        map.setLevel(4);
        return;
      }
      const b = new k.LatLngBounds();
      for (const p of points) b.extend(new k.LatLng(p.lat, p.lng));
      map.setBounds(b);
    },
    panTo(p) {
      map?.panTo(new k.LatLng(p.lat, p.lng));
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
      // Kakao leaves its own elements behind: clear them so another map can mount here.
      host?.replaceChildren();
      host = null;
    },
  };
}
