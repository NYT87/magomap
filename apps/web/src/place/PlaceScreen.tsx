import { ExternalLink, Phone } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePlace, usePlaceSources } from "../data/queries";
import { useLayout } from "../layout/useLayout";
import { useMapStage } from "../map/MapStage";
import { Diary } from "./Diary";
import { kakaoLinks, openKakaoPlace } from "./kakaoLinks";
import { Links } from "./Links";
import { Memberships } from "./Memberships";
import { MovedNote } from "./MovedNote";

/** A place: what it is, the visit diary, links, and the lists it's in. */
export function PlaceScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const place = usePlace(id);
  const sources = usePlaceSources(id);
  const layout = useLayout();
  const { setFocus } = useMapStage();

  // On desktop the map, beside the panel, centres on the place.
  useEffect(() => {
    if (layout === "desktop" && place?.lat != null && place.lng != null) {
      setFocus({ lat: place.lat, lng: place.lng });
    }
  }, [layout, place?.lat, place?.lng, setFocus]);

  useEffect(() => {
    if (place) document.title = `${place.title} – magomap`;
  }, [place]);

  if (place === undefined) return null;
  if (place === null) return <p className="mm-muted">{t("place.notFound")}</p>;

  // Kakao links only for real Kakao places (never for custom pins).
  const kakao = sources?.find((s) => s.provider === "kakao" && !s.externalId.startsWith("pin:"));
  const point =
    place.lat != null && place.lng != null
      ? { title: place.title, lat: place.lat, lng: place.lng }
      : undefined;
  const links = kakao ? kakaoLinks(kakao.externalId, point) : null;

  return (
    <div className="mm-screen mm-place">
      <header className="mm-place__head">
        <h1 className="mm-screen__title">{place.title}</h1>
        {place.category && <p className="mm-muted">{place.category}</p>}
        {(place.roadAddress || place.address) && (
          <p className="mm-place__address">{place.roadAddress ?? place.address}</p>
        )}
        {links && (
          // An icon in the header's top-right corner; its name is the text a screen reader says.
          <a
            className="mm-icon-button mm-place__kakao"
            href={layout === "phone" ? links.app : links.web}
            target={layout === "phone" ? undefined : "_blank"}
            rel="noopener noreferrer"
            aria-label={t("place.openKakao")}
            title={t("place.openKakao")}
            onClick={(e) => {
              if (layout !== "phone") return;
              e.preventDefault();
              openKakaoPlace(links);
            }}
          >
            <ExternalLink aria-hidden size={20} strokeWidth={1.75} />
          </a>
        )}
        {place.phone && (
          <div className="mm-place__actions">
            <a className="mm-button mm-button--tertiary" href={`tel:${place.phone}`}>
              <Phone aria-hidden size={18} strokeWidth={1.75} />
              {t("place.call")}
            </a>
          </div>
        )}
        <MovedNote placeId={id} />
      </header>
      {/* The lists a place is in (and its Kakao notes) first: they say why it's saved. */}
      <Memberships placeId={id} />
      <Diary placeId={id} />
      <Links placeId={id} />
    </div>
  );
}
