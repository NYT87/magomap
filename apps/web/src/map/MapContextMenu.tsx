import type { NearbyResult } from "@magomap/domain";
import { placeRowId } from "@magomap/domain/ids";
import { ArrowLeft, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Sheet } from "../components/Sheet";
import { type PlaceState, placeStatesOf } from "../data/placeState";
import { useLists } from "../data/queries";
import { savePlaceToList } from "../data/saveFromMap";
import { switchesPlace } from "../layout/placeRoute";
import { useLayout } from "../layout/useLayout";
import type { ContextPress } from "./MapAdapter";
import { fetchNearby, type NearbyFailure, nearbyFailure } from "./nearby";

type Lookup =
  | { kind: "loading" }
  | { kind: "failed"; why: NearbyFailure }
  | { kind: "done"; rows: NearbyResult[]; states: Map<string, PlaceState> };

const FAILURE_KEY: Record<NearbyFailure, string> = {
  offline: "map.save.offline",
  rate_limited: "map.save.rateLimited",
  unavailable: "map.save.unavailable",
};

/** The same gap from the window's edges as the app's side gutter. */
const EDGE = 8;

const idOf = (row: NearbyResult) => placeRowId(row.result.provider, row.result.externalId);
/** Kakao's category path ("음식점 > 카페 > 커피전문점"), shortened to its last step. */
const shortCategory = (category: string | null) => category?.split(" > ").at(-1) ?? null;

/**
 * A desktop popover at the pressed spot: not modal, so the map stays usable; Escape or a press
 * anywhere else closes it, and focus goes back where it was.
 */
function Popover({
  at,
  title,
  onClose,
  children,
}: {
  at: ContextPress["at"];
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Kept inside the window: moved left or up when the spot is near its right or bottom edge,
  // again whenever it grows (the places arrive, the list step opens).
  useLayoutEffect(() => {
    const el = ref.current;
    const place = () => {
      const box = el?.getBoundingClientRect();
      const width = box?.width ?? 0;
      const height = box?.height ?? 0;
      setPos({
        left: Math.max(EDGE, Math.min(at.x, window.innerWidth - EDGE - width)),
        top: Math.max(EDGE, Math.min(at.y, window.innerHeight - EDGE - height)),
      });
    };
    place();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [at.x, at.y]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, { capture: true });
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className="mm-map-menu mm-map-menu--popover"
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      <div className="mm-map-menu__head">
        <h2 id={headingId} className="mm-h4">
          {title}
        </h2>
        <button type="button" className="mm-icon-button" onClick={onClose}>
          <X aria-hidden size={20} strokeWidth={1.75} />
          <span className="mm-visually-hidden">{t("map.save.close")}</span>
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}

/**
 * After a right-click or long-press on the map: the Kakao places nearest the spot, then which of
 * her own lists to save the chosen one to (or none, or a new one). Saving opens the place.
 * A sheet on a phone, a popover on a desktop. A newer press replaces what it shows.
 */
export function MapContextMenu({ press, onClose }: { press: ContextPress; onClose: () => void }) {
  const { t } = useTranslation();
  const layout = useLayout();
  const [location, navigate] = useLocation();
  const lists = useLists();
  const chooseId = useId();
  const nameId = useId();
  const [lookup, setLookup] = useState<Lookup>({ kind: "loading" });
  const [chosen, setChosen] = useState<NearbyResult | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  // Opened by her own tap on "New list": the name field is where she goes next.
  useEffect(() => {
    if (naming) nameField.current?.focus();
  }, [naming]);

  // Between the steps, focus follows: into the lists, and back to the place she had picked
  // (the button she was on is gone either way).
  const body = useRef<HTMLDivElement>(null);
  const lastChosen = useRef<string | null>(null);
  useEffect(() => {
    const was = lastChosen.current;
    lastChosen.current = chosen ? idOf(chosen) : null;
    if (chosen) {
      body.current?.querySelector<HTMLElement>(".mm-map-menu__step .mm-map-menu__row")?.focus();
    } else if (was) {
      body.current?.querySelector<HTMLElement>(`[data-place="${CSS.escape(was)}"]`)?.focus();
    }
  }, [chosen]);

  // Each press starts over; an older press's answer, arriving late, is dropped.
  useEffect(() => {
    let current = true;
    setLookup({ kind: "loading" });
    setChosen(null);
    setNaming(false);
    setName("");
    setSaving(false);
    setFailed(false);
    void (async () => {
      try {
        const rows = await fetchNearby(press.point);
        const states = await placeStatesOf(rows.map(idOf));
        if (current) setLookup({ kind: "done", rows, states });
      } catch (error) {
        if (current) setLookup({ kind: "failed", why: nearbyFailure(error) });
      }
    })();
    return () => {
      current = false;
    };
  }, [press]);

  const save = async (target: { listId: string | null } | { newListName: string }) => {
    if (!chosen || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const id = await savePlaceToList(
        "newListName" in target
          ? { result: chosen.result, listId: null, newListName: target.newListName }
          : { result: chosen.result, listId: target.listId },
      );
      navigate(`/places/${encodeURIComponent(id)}`, { replace: switchesPlace(location) });
      onClose();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  const states = lookup.kind === "done" ? lookup.states : null;
  const chosenState = chosen ? states?.get(idOf(chosen)) : undefined;
  const newName = name.trim();

  const places = (
    <div aria-live="polite">
      {lookup.kind === "loading" && <p className="mm-muted">{t("map.save.looking")}</p>}
      {lookup.kind === "failed" && <p className="mm-note">{t(FAILURE_KEY[lookup.why])}</p>}
      {lookup.kind === "done" && lookup.rows.length === 0 && (
        <p className="mm-muted">{t("map.save.none")}</p>
      )}
      {lookup.kind === "done" && lookup.rows.length > 0 && (
        <ul className="mm-map-menu__list">
          {lookup.rows.map((row) => {
            const r = row.result;
            const saved = lookup.states.get(idOf(row))?.saved ?? false;
            return (
              <li key={idOf(row)}>
                <button
                  type="button"
                  className="mm-map-menu__row"
                  data-place={idOf(row)}
                  onClick={() => setChosen(row)}
                >
                  <span className="mm-map-menu__text">
                    <span className="mm-hit__title">{r.title}</span>
                    <span className="mm-muted">
                      {[shortCategory(r.category), r.roadAddress ?? r.address]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="mm-map-menu__meta">
                    <span className="mm-map-menu__distance">
                      {t("map.save.distance", { m: row.distanceM })}
                    </span>
                    {saved && <span className="mm-badge">{t("map.save.saved")}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const listStep = chosen && (
    <div className="mm-map-menu__step">
      <div className="mm-map-menu__chosen">
        <button
          type="button"
          className="mm-icon-button"
          disabled={saving}
          onClick={() => {
            setChosen(null);
            setNaming(false);
            setFailed(false);
          }}
        >
          <ArrowLeft aria-hidden size={20} strokeWidth={1.75} />
          <span className="mm-visually-hidden">{t("map.save.back")}</span>
        </button>
        <span className="mm-hit__title">{chosen.result.title}</span>
        {chosenState?.saved && <span className="mm-badge">{t("map.save.saved")}</span>}
      </div>
      <p id={chooseId} className="mm-field__label">
        {t("map.save.chooseList")}
      </p>
      <ul className="mm-map-menu__list" aria-labelledby={chooseId}>
        {(lists?.mine ?? []).map(({ list }) => {
          const inIt = chosenState?.listIds.has(list.id) ?? false;
          return (
            <li key={list.id}>
              <button
                type="button"
                className="mm-map-menu__row"
                disabled={saving}
                onClick={() => void save({ listId: list.id })}
              >
                <span className="mm-map-menu__text">
                  <span className="mm-map-menu__name">{list.name}</span>
                </span>
                {inIt && <span className="mm-badge">{t("map.save.alreadyIn")}</span>}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="mm-map-menu__row"
            disabled={saving}
            onClick={() => void save({ listId: null })}
          >
            <span className="mm-map-menu__text">
              <span className="mm-map-menu__name">{t("map.save.noList")}</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="mm-map-menu__row"
            aria-expanded={naming}
            disabled={saving}
            onClick={() => setNaming((v) => !v)}
          >
            <span className="mm-map-menu__text">
              <span className="mm-map-menu__name">{t("map.save.newList")}</span>
            </span>
          </button>
        </li>
      </ul>
      {naming && (
        <form
          className="mm-map-menu__new"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName) void save({ newListName: newName });
          }}
        >
          <label className="mm-field" htmlFor={nameId}>
            <span className="mm-field__label">{t("map.save.newListName")}</span>
          </label>
          <input
            id={nameId}
            className="mm-input"
            value={name}
            ref={nameField}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="mm-button mm-button--primary"
            disabled={!newName || saving}
          >
            {saving ? t("map.save.saving") : t("map.save.confirm")}
          </button>
        </form>
      )}
      <div aria-live="polite">
        {saving && !naming && <p className="mm-muted">{t("map.save.saving")}</p>}
      </div>
      {failed && (
        <p className="mm-error" role="alert">
          {t("map.save.saveFailed")}
        </p>
      )}
    </div>
  );

  const content = (
    <div ref={body} className="mm-map-menu__body">
      {listStep || places}
    </div>
  );
  const title = t("map.save.title");
  return layout === "phone" ? (
    <Sheet title={title} onClose={onClose}>
      {content}
    </Sheet>
  ) : (
    <Popover at={press.at} title={title} onClose={onClose}>
      {content}
    </Popover>
  );
}
