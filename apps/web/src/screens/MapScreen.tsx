import { Layers, List as ListIcon, LocateFixed, Map as MapIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Sheet } from "../components/Sheet";
import { useLayout } from "../layout/useLayout";
import { ListPicker } from "../map/ListPicker";
import { useMapStage } from "../map/MapStage";
import { MapView } from "../map/MapView";
import { useMapData } from "../map/useMapData";
import { VisiblePlacesList } from "../map/VisiblePlacesList";

/** Asks for the position only when tapped. */
function useLocate() {
  const { map } = useMapStage();
  const [denied, setDenied] = useState(false);
  const locate = () => {
    setDenied(false);
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.current?.showMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setDenied(true),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  return { locate, denied };
}

export function MissingLocationNote({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return <p className="mm-note">{t("map.noLocation", { count })}</p>;
}

/** The always-mounted map, with its phone controls at the root. */
export function MapScreen({ search }: { search?: ReactNode }) {
  const { t } = useTranslation();
  const layout = useLayout();
  const [location] = useLocation();
  const data = useMapData();
  const [sheet, setSheet] = useState(false);
  const [asList, setAsList] = useState(false);
  const { locate, denied } = useLocate();
  const phoneRoot = layout === "phone" && location === "/";

  return (
    <>
      <MapView data={data} />
      {phoneRoot && (
        <>
          <div className="mm-map-top">{search}</div>
          <div className="mm-map-tools">
            <button type="button" className="mm-fab" onClick={() => setSheet(true)}>
              <Layers aria-hidden size={22} strokeWidth={1.75} />
              <span className="mm-visually-hidden">{t("map.layers")}</span>
            </button>
            <button type="button" className="mm-fab" onClick={locate}>
              <LocateFixed aria-hidden size={22} strokeWidth={1.75} />
              <span className="mm-visually-hidden">{t("map.myLocation")}</span>
            </button>
            <button
              type="button"
              className="mm-fab"
              aria-pressed={asList}
              onClick={() => setAsList((v) => !v)}
            >
              {asList ? (
                <MapIcon aria-hidden size={22} strokeWidth={1.75} />
              ) : (
                <ListIcon aria-hidden size={22} strokeWidth={1.75} />
              )}
              <span className="mm-visually-hidden">
                {asList ? t("map.mapView") : t("map.listView")}
              </span>
            </button>
          </div>
          <div className="mm-map-notes" aria-live="polite">
            {denied && <p className="mm-note">{t("map.locationDenied")}</p>}
            <MissingLocationNote count={data?.withoutLocation ?? 0} />
          </div>
          {asList && data && (
            <div className="mm-list-overlay">
              <VisiblePlacesList places={data.shownPlaces} />
            </div>
          )}
          {sheet && data && (
            <Sheet title={t("picker.title")} onClose={() => setSheet(false)}>
              <ListPicker sections={data.sections} heading={false} />
            </Sheet>
          )}
        </>
      )}
      {layout === "desktop" && (
        <div className="mm-map-tools">
          <button type="button" className="mm-fab" onClick={locate}>
            <LocateFixed aria-hidden size={22} strokeWidth={1.75} />
            <span className="mm-visually-hidden">{t("map.myLocation")}</span>
          </button>
          {denied && <p className="mm-note">{t("map.locationDenied")}</p>}
        </div>
      )}
    </>
  );
}

/** The desktop panel at the root: which lists show, and the places on the map. */
export function HomePanel({ search }: { search?: ReactNode }) {
  const data = useMapData();
  if (!data) return null;
  return (
    <div className="mm-screen">
      {search}
      <ListPicker sections={data.sections} />
      <MissingLocationNote count={data.withoutLocation} />
      <VisiblePlacesList places={data.shownPlaces} />
    </div>
  );
}
