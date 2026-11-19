import type { PlaceLocationRow, PlaceRow } from "@magomap/domain";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useConfig } from "../auth/useConfig";
import { preloadLeaflet } from "./leafletAdapter";
import { loadMapAdapter } from "./loadMapAdapter";
import { DEFAULT_VIEW, type MapAdapter } from "./MapAdapter";
import { useMapStage } from "./MapStage";
import { PreviousLocationCard } from "./PreviousLocationCard";
import type { useMapData } from "./useMapData";

type Data = NonNullable<ReturnType<typeof useMapData>>;

/** The map itself: loads Kakao or Leaflet once, then follows the markers. */
export function MapView({ data }: { data: Data | null }) {
  const { t } = useTranslation();
  const config = useConfig();
  const stage = useMapStage();
  const [, navigate] = useLocation();
  const el = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const fitted = useRef(false);
  const [previous, setPrevious] = useState<{ location: PlaceLocationRow; place: PlaceRow } | null>(
    null,
  );

  // Without a Kakao key the map is Leaflet: start its download now, not after config and data.
  useEffect(() => {
    if (!config?.kakaoJavascriptKey) void preloadLeaflet();
  }, [config?.kakaoJavascriptKey]);

  // Load once: with the config if it arrives quickly, otherwise as if there were no Kakao key.
  const loading = useRef(false);
  useEffect(() => {
    if (loading.current) return;
    const start = (c: typeof config) => {
      if (loading.current) return;
      loading.current = true;
      void loadMapAdapter(c ?? { kakaoJavascriptKey: null, devLoginEnabled: false }).then((a) => {
        if (!el.current) return;
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
  }, [config, stage.map]);

  useEffect(() => () => adapter?.destroy(), [adapter]);

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
      navigate(`/places/${encodeURIComponent(id)}`);
    });
  }, [adapter, navigate, stage.onSearchSelect]);

  useEffect(() => {
    if (!adapter || !data) return;
    adapter.setMarkers([...data.markers, ...stage.searchMarkers]);
    const saved = data.markers.filter((m) => m.kind === "saved");
    if (!fitted.current && saved.length > 0) {
      fitted.current = true;
      adapter.fitTo(saved.map((m) => m.position));
    }
  }, [adapter, data, stage.searchMarkers]);

  useEffect(() => {
    // Looking at one place: bring it close, not just to the middle of the country.
    if (adapter && stage.focus) adapter.fitTo([stage.focus]);
  }, [adapter, stage.focus]);

  const providerName =
    adapter?.provider === "kakao" ? t("map.providerKakao") : t("map.providerOsm");
  return (
    <div className="mm-mapview">
      <div ref={el} className="mm-mapview__canvas" />
      {adapter && <p className="mm-map-caption">{t("map.mapBy", { name: providerName })}</p>}
      {previous && (
        <PreviousLocationCard
          location={previous.location}
          place={previous.place}
          onClose={() => setPrevious(null)}
        />
      )}
    </div>
  );
}
