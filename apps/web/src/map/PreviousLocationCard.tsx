import type { PlaceLocationRow, PlaceRow } from "@magomap/domain";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { formatDate } from "../i18n";

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
  const now = place.roadAddress ?? place.address;
  return (
    <div className="mm-floating-card" role="dialog" aria-label={place.title}>
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
        className="mm-button mm-button--primary"
      >
        {t("map.openPlace")}
      </Link>
    </div>
  );
}
