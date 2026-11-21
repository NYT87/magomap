import type { PlaceRow } from "@magomap/domain";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";

/** The places on the map as a plain list: for screen readers, keyboards, and quick scanning. */
export function VisiblePlacesList({
  places,
  moved = new Set(),
  selectedId,
}: {
  places: PlaceRow[];
  /** Places with previous locations. */
  moved?: Set<string>;
  /** The place whose details are open. */
  selectedId?: string;
}) {
  const { t } = useTranslation();
  const sorted = [...places].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <section className="mm-places" id="places" aria-label={t("map.placesTitle")}>
      <h2 className="mm-h4">{t("map.placesTitle")}</h2>
      {sorted.length === 0 ? (
        <p className="mm-muted">{t("map.empty")}</p>
      ) : (
        <ul className="mm-places__list">
          {sorted.map((p) => (
            <li key={p.id}>
              <Link
                href={`/places/${encodeURIComponent(p.id)}`}
                className="mm-place-row"
                aria-current={p.id === selectedId ? "true" : undefined}
              >
                <span className="mm-place-row__title">{p.title}</span>
                <span className="mm-muted">{p.roadAddress ?? p.address ?? ""}</span>
                {moved.has(p.id) && <span className="mm-moved-hint">{t("map.hasPrevious")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
