export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapMarker {
  id: string;
  position: LatLng;
  color: string;
  label: string;
  kind: "saved" | "search" | "previous";
  placeId?: string;
  /** The saved place whose details are open; only ever true on a "saved" marker. */
  selected?: boolean;
}

/** What the app needs from a map; Kakao Maps and Leaflet both implement it. */
export interface MapAdapter {
  readonly provider: "kakao" | "leaflet";
  mount(el: HTMLElement, view: { center: LatLng; zoom: number }): void;
  /**
   * Saved and previous markers cluster; previous ones are faded and smaller. A selected marker
   * never clusters and is drawn above all others.
   */
  setMarkers(markers: MapMarker[]): void;
  fitTo(points: LatLng[]): void;
  panTo(point: LatLng): void;
  getCenter(): LatLng;
  /** Leaflet-style zoom (0–19), whichever map this is. */
  getZoom(): number;
  /** Called after the map stops moving (the user's drag or zoom, or a fit). */
  onViewChange(cb: () => void): void;
  /** A fit asked for before the map could do it (still loading); null when none is waiting. */
  pendingFit(): LatLng[] | null;
  /** Where "my location" was last shown, if it was. */
  myLocation(): LatLng | null;
  onSelect(cb: (markerId: string) => void): void;
  /** Shows where I am, and by default moves the map there. */
  showMyLocation(p: LatLng, opts?: { recenter?: boolean }): void;
  destroy(): void;
}

/** Jeju, where most of the first places are; replaced by fitting to saved places. */
export const DEFAULT_VIEW = { center: { lat: 33.4, lng: 126.55 }, zoom: 10 };
