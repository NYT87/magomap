import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Focus } from "./applyFocus";
import type { LatLng, MapAdapter, MapMarker } from "./MapAdapter";

/** Shared between the map and the panels: search markers, and where to look. */
interface Stage {
  searchMarkers: MapMarker[];
  setSearchMarkers: (m: MapMarker[]) => void;
  focus: Focus | null;
  /** Where to look; `close` lets the map zoom in to it (for a place she hasn't saved). */
  setFocus: (p: LatLng | null, opts?: { close?: boolean }) => void;
  /** The mounted map, for search near what's on screen. */
  map: MutableRefObject<MapAdapter | null>;
  /** Called when a search marker is tapped. */
  onSearchSelect: ((id: string) => void) | null;
  setOnSearchSelect: (fn: ((id: string) => void) | null) => void;
}

const Ctx = createContext<Stage | null>(null);

export function MapStageProvider({ children }: { children: ReactNode }) {
  const [searchMarkers, setSearchMarkers] = useState<MapMarker[]>([]);
  const [focus, setFocusState] = useState<Focus | null>(null);
  const setFocus = useCallback(
    (p: LatLng | null, opts?: { close?: boolean }) =>
      setFocusState(p && { ...p, ...(opts?.close ? { close: true } : {}) }),
    [],
  );
  const map = useRef<MapAdapter | null>(null);
  const [onSearchSelect, setSelect] = useState<((id: string) => void) | null>(null);
  const setOnSearchSelect = useCallback(
    (fn: ((id: string) => void) | null) => setSelect(() => fn),
    [],
  );
  const value = useMemo<Stage>(
    () => ({
      searchMarkers,
      setSearchMarkers,
      focus,
      setFocus,
      map,
      onSearchSelect,
      setOnSearchSelect,
    }),
    [searchMarkers, focus, setFocus, onSearchSelect, setOnSearchSelect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMapStage(): Stage {
  const v = useContext(Ctx);
  if (!v) throw new Error("MapStageProvider missing");
  return v;
}
