import { ChevronUp, X } from "lucide-react";
import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { usePlace, usePlaceMemberships } from "../data/queries";
import { useMapStage } from "../map/MapStage";
import { peekNoteOf } from "./kakaoNotes";
import { useDragUp } from "./useDragUp";

/**
 * A phone's place, over the map: a small card with the name that opens the details page from its
 * arrow button, or by dragging it up. The X goes back to the map.
 */
export function PlacePeek({ id }: { id: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const place = usePlace(id);
  const memberships = usePlaceMemberships(id);
  const { setFocus } = useMapStage();
  const headingId = useId();
  const openDetails = () => navigate(`/places/${encodeURIComponent(id)}/details`);
  const { handlers, offset, dragging } = useDragUp({ onOpen: openDetails });

  // The map, behind the card, brings the place to the middle (the zoom stays).
  useEffect(() => {
    if (place?.lat != null && place.lng != null) setFocus({ lat: place.lat, lng: place.lng });
  }, [place?.lat, place?.lng, setFocus]);

  if (place === undefined) return null;
  const close = (
    <button type="button" className="mm-icon-button" onClick={() => navigate("/")}>
      <X aria-hidden size={22} strokeWidth={1.75} />
      <span className="mm-visually-hidden">{t("place.peek.close")}</span>
    </button>
  );
  if (place === null) {
    return (
      <section className="mm-place-peek" aria-label={t("place.peek.region")}>
        <div className="mm-place-peek__row">
          <p className="mm-muted mm-place-peek__text">{t("place.notFound")}</p>
          <div className="mm-place-peek__actions">{close}</div>
        </div>
      </section>
    );
  }

  const muted = place.category ?? place.roadAddress ?? place.address;
  const note = peekNoteOf(memberships ?? []);
  return (
    <section
      className="mm-place-peek"
      data-dragging={dragging || undefined}
      aria-labelledby={headingId}
      {...handlers}
      style={{
        ...handlers.style,
        transform: offset === 0 ? undefined : `translateY(${offset}px)`,
      }}
    >
      <span className="mm-place-peek__grip" aria-hidden />
      <div className="mm-place-peek__row">
        <div className="mm-place-peek__text">
          <h2 id={headingId} className="mm-place-peek__name">
            {place.title}
          </h2>
          {muted && <p className="mm-muted mm-place-peek__muted">{muted}</p>}
          {note && <p className="mm-place-peek__note">{note}</p>}
        </div>
        <div className="mm-place-peek__actions">
          <button type="button" className="mm-icon-button" onClick={openDetails}>
            <ChevronUp aria-hidden size={22} strokeWidth={1.75} />
            <span className="mm-visually-hidden">{t("place.peek.openDetails")}</span>
          </button>
          {close}
        </div>
      </div>
    </section>
  );
}
