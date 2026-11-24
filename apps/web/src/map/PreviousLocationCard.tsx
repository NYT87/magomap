import type { PlaceLocationRow, PlaceRow } from "@magomap/domain";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { formatDate } from "../i18n";
import { switchesPlace } from "../layout/placeRoute";

/** Shown when a faded previous-location marker is tapped. */
export function PreviousLocationCard({
  location,
  place,
  onClose,
}: {
  location: PlaceLocationRow;
  place: PlaceRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [current] = useLocation();
  const now = place.roadAddress ?? place.address;
  const ref = useRef<HTMLElement>(null);
  // Focus moves to the card, Esc closes it, and focus goes back to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);
  return (
    <section ref={ref} className="mm-floating-card" aria-label={place.title} tabIndex={-1}>
      <div className="mm-floating-card__head">
        <h2 className="mm-h4">{place.title}</h2>
        <button type="button" className="mm-icon-button" onClick={onClose}>
          <X aria-hidden size={20} strokeWidth={1.75} />
          <span className="mm-visually-hidden">{t("map.close")}</span>
        </button>
      </div>
      <p className="mm-moved-line">
        {t("map.previousUntil", { date: formatDate(location.validUntil) })}
      </p>
      <p className="mm-muted">{now ? t("map.nowAt", { address: now }) : t("map.nowUnknown")}</p>
      <Link
        href={`/places/${encodeURIComponent(place.id)}`}
        replace={switchesPlace(current)}
        className="mm-button mm-button--primary"
      >
        {t("map.openPlace")}
      </Link>
    </section>
  );
}
