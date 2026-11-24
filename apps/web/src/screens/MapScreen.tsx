import { Layers, List as ListIcon, LocateFixed, Map as MapIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { SyncIndicator } from "../components/SyncIndicator";
import { NoticeSlot } from "../layout/AppLayout";
import { placeRouteOf } from "../layout/placeRoute";
import { useLayout } from "../layout/useLayout";
import { useMapStage } from "../map/MapStage";
import { MapView } from "../map/MapView";
import { useMapData } from "../map/useMapData";
import { VisiblePlacesList } from "../map/VisiblePlacesList";
import { PlacePeek } from "../place/PlacePeek";
import { SearchBar } from "../search/SearchBar";

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
export function MapScreen() {
  const { t } = useTranslation();
  const layout = useLayout();
  const [location, navigate] = useLocation();
  const placeRoute = placeRouteOf(location);
  const selectedId = placeRoute?.id;
  const data = useMapData(selectedId);
  const [asList, setAsList] = useState(false);
  const { locate, denied } = useLocate();
  const phoneRoot = layout === "phone" && location === "/";

  return (
    <>
      <MapView data={data} />
      {phoneRoot && (
        <>
          <div className="mm-map-overlay">
            <div className="mm-map-top">
              <SearchBar />
            </div>
            <div className="mm-map-tools">
              <SyncIndicator compact />
              <button type="button" className="mm-fab" onClick={() => navigate("/lists")}>
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
          </div>
          <div className="mm-map-notes">
            <div className="mm-map-notes__live" aria-live="polite">
              {denied && <p className="mm-note">{t("map.locationDenied")}</p>}
              <MissingLocationNote count={data?.withoutLocation ?? 0} />
              {data && data.shownPlaces.length === 0 && !asList && (
                <p className="mm-note">{t("map.empty")}</p>
              )}
            </div>
            <NoticeSlot />
          </div>
          {asList && data && (
            <div className="mm-list-overlay">
              <VisiblePlacesList places={data.shownPlaces} moved={data.moved} />
            </div>
          )}
        </>
      )}
      {layout === "phone" && placeRoute && !placeRoute.details && <PlacePeek id={placeRoute.id} />}
      {layout === "desktop" && (
        <div className="mm-map-tools">
          <button type="button" className="mm-fab" onClick={locate}>
            <LocateFixed aria-hidden size={22} strokeWidth={1.75} />
            <span className="mm-visually-hidden">{t("map.myLocation")}</span>
          </button>
          <div role="status">{denied && <p className="mm-note">{t("map.locationDenied")}</p>}</div>
        </div>
      )}
    </>
  );
}

/** The desktop panel at the root: search, and the places on the map. */
export function HomePanel() {
  const data = useMapData();
  if (!data) return null;
  return (
    <div className="mm-screen">
      <SearchBar />
      <MissingLocationNote count={data.withoutLocation} />
      <VisiblePlacesList places={data.shownPlaces} moved={data.moved} />
    </div>
  );
}
