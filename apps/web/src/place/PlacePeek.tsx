import { useLiveQuery } from "dexie-react-hooks";
import { ChevronUp, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { currentDb } from "../data/db";
import { usePlaceMemberships } from "../data/queries";
import { goBackOr } from "../layout/appHistory";
import { useMapStage } from "../map/MapStage";
import { peekNoteOf } from "./kakaoNotes";
import { useDragUp } from "./useDragUp";

/**
 * A phone's place, over the map: a small card with the name that opens the details page when
 * tapped, from its arrow button (the keyboard's way), or by dragging it up. The X goes back
 * where she came from (else the map).
 */
export function PlacePeek({ id }: { id: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  // The row even when deleted, so a deleted place can say so (null: not on this device).
  const row = useLiveQuery(async () => (await currentDb().places.get(id)) ?? null, [id]);
  const place = row && row.deletedAt == null ? row : row === undefined ? undefined : null;
  const gone = row != null && row.deletedAt != null;
  const memberships = usePlaceMemberships(id);
  const { setFocus } = useMapStage();
  const headingId = useId();
  const openDetails = () => navigate(`/places/${encodeURIComponent(id)}/details`);
  const { handlers, offset, dragging } = useDragUp({ onOpen: openDetails, openOnTap: true });

  const heading = useRef<HTMLHeadingElement>(null);
  const focusedFor = useRef<string | null>(null);

  // A newly opened place (or Back from its details) takes focus on its name, so a screen reader
  // says which place opened and the keyboard starts here.
  useEffect(() => {
    if (!place || focusedFor.current === id) return;
    focusedFor.current = id;
    heading.current?.focus({ preventScroll: true });
  }, [id, place]);

  // Its height, for the cards that sit above it (a previous location's card). A callback ref,
  // so it follows the card through loading, not-found and the place itself.
  const observer = useRef<ResizeObserver | null>(null);
  const card = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize;
      if (height !== undefined) {
        document.documentElement.style.setProperty("--mm-peek-height", `${Math.ceil(height)}px`);
      }
    });
    observer.current.observe(el);
  }, []);
  useEffect(
    () => () => {
      observer.current?.disconnect();
      document.documentElement.style.removeProperty("--mm-peek-height");
    },
    [],
  );

  // The map, behind the card, brings the place to the middle (the zoom stays).
  useEffect(() => {
    if (place?.lat != null && place.lng != null) setFocus({ lat: place.lat, lng: place.lng });
  }, [place?.lat, place?.lng, setFocus]);

  if (place === undefined) return null;
  const close = (
    <button type="button" className="mm-icon-button" onClick={() => goBackOr(navigate, "/")}>
      <X aria-hidden size={22} strokeWidth={1.75} />
      <span className="mm-visually-hidden">{t("place.peek.close")}</span>
    </button>
  );
  if (place === null) {
    return (
      <section ref={card} className="mm-place-peek" aria-label={t("place.peek.region")}>
        <div className="mm-place-peek__row">
          <p className="mm-muted mm-place-peek__text">
            {gone ? t("place.peek.gone") : t("place.notFound")}
          </p>
          <div className="mm-place-peek__actions">{close}</div>
        </div>
      </section>
    );
  }

  const muted = place.category ?? place.roadAddress ?? place.address;
  const note = peekNoteOf(memberships ?? []);
  return (
    <section
      ref={card}
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
          <h2 id={headingId} ref={heading} tabIndex={-1} className="mm-place-peek__name">
            {place.title}
          </h2>
          {muted && <p className="mm-muted mm-place-peek__muted">{muted}</p>}
          {note && (
            <p className="mm-place-peek__note">
              <span className="mm-place-peek__note-label">{t("place.peek.kakaoNote")}</span> {note}
            </p>
          )}
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
