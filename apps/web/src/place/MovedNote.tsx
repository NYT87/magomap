import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlaceLocations } from "../data/queries";
import { formatDate } from "../i18n";

/** "Moved": opens into the place's previous addresses and when it was at each. */
export function MovedNote({ placeId }: { placeId: string }) {
  const { t } = useTranslation();
  const locations = usePlaceLocations(placeId);
  const [open, setOpen] = useState(false);
  if (!locations || locations.length === 0) return null;
  return (
    <div className="mm-moved">
      <button
        type="button"
        className="mm-moved__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t("place.moved")}
      </button>
      {open && (
        <ul className="mm-moved__list">
          {locations.map((l) => (
            <li key={l.id}>
              {t("place.movedFromTo", {
                address: l.roadAddress ?? l.address ?? t("place.unknownAddress"),
                from: formatDate(l.validFrom),
                until: formatDate(l.validUntil),
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
