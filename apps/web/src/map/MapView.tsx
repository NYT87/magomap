import type { PlaceLocationRow, PlaceRow } from "@magomap/domain";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useConfig } from "../auth/useConfig";
import type { SavedFromMap } from "../data/saveFromMap";
import { switchesPlace } from "../layout/placeRoute";
import { applyFocus } from "./applyFocus";
import { centrePress } from "./centrePress";
import { redrawKeepingFocus } from "./keepFocus";
import { preloadLeaflet } from "./leafletAdapter";
import { createAdapter, loadKakaoSdk } from "./loadMapAdapter";
import { type ContextPress, DEFAULT_VIEW, type MapAdapter } from "./MapAdapter";
import { MapContextMenu } from "./MapContextMenu";
import { useMapStage } from "./MapStage";
import { useMapPrefs } from "./mapPrefs";
import { PreviousLocationCard } from "./PreviousLocationCard";
import { providerFor } from "./providerChoice";
import { SaveConfirmation } from "./SaveConfirmation";
import { swapAdapter } from "./swapAdapter";
import type { useMapData } from "./useMapData";

type Data = NonNullable<ReturnType<typeof useMapData>>;

/**
 * The map itself: Kakao Map or OpenStreetMap, chosen by the Map setting and, on Automatic, by
 * where the map is. It switches in place when that answer changes, then follows the markers.
 */
export function MapView({ data }: { data: Data | null }) {
  const { t } = useTranslation();
  const config = useConfig();
  const stage = useMapStage();
  const { mapChoice, setKakaoAvailable } = useMapPrefs();
  const [location, navigate] = useLocation();
  // Read when a pin is tapped (the tap handler is set once per adapter).
  const locationRef = useRef(location);
  locationRef.current = location;
  const el = useRef<HTMLElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const fitted = useRef(false);
  const [previous, setPrevious] = useState<{ location: PlaceLocationRow; place: PlaceRow } | null>(
    null,
  );
  const choice = useRef(mapChoice);
  choice.current = mapChoice;
  const kakaoReady = useRef(false);
  const hintId = useId();
  // A right-click or long-press opens the menu that saves a place from the map.
  const [press, setPress] = useState<ContextPress | null>(null);
  const keyboardPressAt = useRef(0);
  // The latest save from the menu, confirmed with Undo; a newer one replaces it.
  const [saved, setSaved] = useState<{
    saved: SavedFromMap;
    release: () => void;
    n: number;
  } | null>(null);
  const savedCount = useRef(0);

  // When the map will be Leaflet, start its download now, not after config and data.
  useEffect(() => {
    if (!config?.kakaoJavascriptKey || mapChoice === "osm") void preloadLeaflet();
  }, [config?.kakaoJavascriptKey, mapChoice]);

  // Load once: with the config if it arrives quickly, otherwise as if there were no Kakao key.
  const loading = useRef(false);
  useEffect(() => {
    if (loading.current) return;
    const start = (c: typeof config) => {
      if (loading.current) return;
      loading.current = true;
      void loadKakaoSdk(c?.kakaoJavascriptKey ?? null).then((ready) => {
        kakaoReady.current = ready;
        setKakaoAvailable(ready);
        if (!el.current) return;
        const a = createAdapter(providerFor(choice.current, DEFAULT_VIEW.center, null, ready));
        a.mount(el.current, DEFAULT_VIEW);
        stage.map.current = a;
        setAdapter(a);
      });
    };
    if (config) start(config);
    else {
      const timer = setTimeout(() => start(null), 1_500);
      return () => clearTimeout(timer);
    }
  }, [config, stage.map, setKakaoAvailable]);

  // Ask again which map fits (after a move, or a new setting); switch in place if it changed.
  const reconsider = useCallback(() => {
    const current = stage.map.current;
    if (!current || !el.current) return;
    const want = providerFor(
      choice.current,
      current.getCenter(),
      current.provider,
      kakaoReady.current,
    );
    if (want === current.provider) return;
    const next = createAdapter(want);
    swapAdapter(current, next, el.current);
    stage.map.current = next;
    setAdapter(next);
  }, [stage.map]);

  useEffect(() => {
    adapter?.onViewChange(reconsider);
  }, [adapter, reconsider]);

  useEffect(() => {
    void mapChoice;
    reconsider();
  }, [mapChoice, reconsider]);

  useEffect(() => () => adapter?.destroy(), [adapter]);

  useEffect(() => {
    adapter?.onContextPress((p) => {
      // The menu key also sends the browser's context menu event, at no useful spot: the
      // keyboard's press (at the centre) stands.
      if (Date.now() - keyboardPressAt.current < 500) return;
      setPress(p);
    });
  }, [adapter]);

  // Without a mouse: the menu key or Shift+F10 on the focused map opens it at the centre.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey)) return;
    const current = stage.map.current;
    if (!current || !el.current) return;
    e.preventDefault();
    keyboardPressAt.current = Date.now();
    setPress(centrePress(current, el.current));
  };

  // The phone's Save button opens it at the centre too, as the keyboard does.
  useEffect(() => {
    const saveHere = stage.saveHere;
    saveHere.current = () => {
      const current = stage.map.current;
      if (current && el.current) setPress(centrePress(current, el.current));
    };
    return () => {
      saveHere.current = null;
    };
  }, [stage.saveHere, stage.map]);

  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!adapter) return;
    adapter.onSelect((id) => {
      const d = dataRef.current;
      if (id.startsWith("search:")) return stage.onSearchSelect?.(id);
      if (id.startsWith("prev:") && d) {
        const location = d.lib.locations.find((l) => `prev:${l.id}` === id);
        const place = location && d.lib.places.get(location.placeId);
        if (location && place) setPrevious({ location, place });
        return;
      }
      // From one place's peek to another: a switch, not one more step for Back.
      navigate(`/places/${encodeURIComponent(id)}`, {
        replace: switchesPlace(locationRef.current),
      });
    });
  }, [adapter, navigate, stage.onSearchSelect]);

  useEffect(() => {
    if (!adapter || !data) return;
    const markers = [...data.markers, ...stage.searchMarkers];
    redrawKeepingFocus(el.current, () => adapter.setMarkers(markers));
    const saved = data.markers.filter((m) => m.kind === "saved");
    if (!fitted.current && saved.length > 0) {
      fitted.current = true;
      adapter.fitTo(saved.map((m) => m.position));
    }
  }, [adapter, data, stage.searchMarkers]);

  // Looking at one place: a saved one is only brought to the middle (the zoom stays), a search
  // result is brought close. Once per place: a map switch must not pull the view back (that
  // would switch again, and again).
  const focused = useRef<typeof stage.focus>(null);
  useEffect(() => {
    if (!adapter || !stage.focus || focused.current === stage.focus) return;
    focused.current = stage.focus;
    applyFocus(adapter, stage.focus);
  }, [adapter, stage.focus]);

  const providerName =
    adapter?.provider === "kakao" ? t("map.providerKakao") : t("map.providerOsm");
  return (
    <div className="mm-mapview">
      {/* The map handles its own keys (arrows pan; the menu key opens the save menu). Both
          maps make this element focusable when they mount. */}
      <section
        ref={el}
        className="mm-mapview__canvas"
        aria-label={t("map.canvasLabel")}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
      />
      <p id={hintId} className="mm-visually-hidden">
        {t("map.canvasHint")}
      </p>
      {adapter && <p className="mm-map-caption">{t("map.mapBy", { name: providerName })}</p>}
      {previous && (
        <PreviousLocationCard
          location={previous.location}
          place={previous.place}
          onClose={() => setPrevious(null)}
        />
      )}
      {press && (
        <MapContextMenu
          press={press}
          onClose={() => setPress(null)}
          onSaved={(s, release) => {
            savedCount.current += 1;
            setSaved({ saved: s, release, n: savedCount.current });
          }}
        />
      )}
      {saved && (
        <SaveConfirmation
          key={saved.n}
          saved={saved.saved}
          release={saved.release}
          onDone={() => setSaved(null)}
        />
      )}
    </div>
  );
}
