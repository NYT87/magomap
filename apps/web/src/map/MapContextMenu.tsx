import type { NearbyResult } from "@magomap/domain";
import { placeRowId } from "@magomap/domain/ids";
import { ArrowLeft, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Sheet } from "../components/Sheet";
import { currentDb } from "../data/db";
import { holdPushes } from "../data/events";
import { type PlaceState, placeStatesOf } from "../data/placeState";
import { isKakaoPlaceKey, useLists } from "../data/queries";
import { type SavedFromMap, savePlaceToList } from "../data/saveFromMap";
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
 * A desktop popover at the pressed spot: not modal, so the map stays usable; Escape (or
 * `onEscape`, when given), a press anywhere else or focus leaving it closes it, and focus goes
 * back where it was (the map).
 */
function Popover({
  at,
  title,
  onClose,
  onEscape,
  children,
}: {
  at: ContextPress["at"];
  title: string;
  onClose: () => void;
  onEscape?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  // Kept inside the window: moved left or up when the spot is near its right or bottom edge,
  // again whenever it grows (the places arrive, the list step opens) or the window changes
  // (a resize, a tablet turned).
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
    window.addEventListener("resize", place);
    const observer = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (el) observer?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [at.x, at.y]);

  useEffect(() => {
    const el = ref.current;
    const before = document.activeElement as HTMLElement | null;
    el?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (escapeRef.current ?? closeRef.current)();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !el?.contains(e.target)) closeRef.current();
    };
    // Tab past its last control (or Shift+Tab before its first) leaves it: it closes. Focus
    // going nowhere (the button she was on gave way to the next step) isn't leaving.
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && !el?.contains(e.relatedTarget)) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, { capture: true });
    el?.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, { capture: true });
      el?.removeEventListener("focusout", onFocusOut);
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
 * her own lists to save the chosen one to (or none, or a new one). Saving opens the place and
 * hands what it did to `onSaved` (for its confirmation and Undo), with sending held back until
 * `release` is called. A sheet on a phone, a popover on a desktop. A newer press replaces what
 * it shows.
 */
export function MapContextMenu({
  press,
  found,
  onClose,
  onSaved,
}: {
  press: ContextPress;
  /** A place already found (a search result): no lookup, straight to its lists. */
  found?: NearbyResult;
  onClose: () => void;
  onSaved?: (saved: SavedFromMap, release: () => void) => void;
}) {
  const { t } = useTranslation();
  const layout = useLayout();
  const [location, navigate] = useLocation();
  const lists = useLists();
  const chooseId = useId();
  const nameId = useId();
  const kakaoId = useId();
  const [lookup, setLookup] = useState<Lookup>({ kind: "loading" });
  // Bumped by Try again: the same point, asked again.
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<NearbyResult | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The status region starts empty, so what it says next is announced.
  const [mounted, setMounted] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  // Which press the menu is on: a save that finishes after a newer press must not act on it.
  const pressToken = useRef(0);
  const savingNow = useRef(false);
  const retried = useRef(false);

  useEffect(() => {
    setMounted(true);
    // Closed or gone: a save still running acts on nothing (and lets go of its hold).
    return () => {
      pressToken.current += 1;
    };
  }, []);

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

  // Each press starts over.
  useEffect(() => {
    void press;
    pressToken.current += 1;
    savingNow.current = false;
    setChosen(found ?? null);
    setNaming(false);
    setName("");
    setSaving(false);
    setFailed(false);
  }, [press, found]);

  // The lookup, again on Try again; an older one's answer, arriving late, is dropped.
  useEffect(() => {
    void attempt;
    let current = true;
    setLookup({ kind: "loading" });
    void (async () => {
      try {
        const rows = found ? [found] : await fetchNearby(press.point);
        const states = await placeStatesOf(rows.map(idOf));
        if (current) setLookup({ kind: "done", rows, states });
      } catch (error) {
        if (current) setLookup({ kind: "failed", why: nearbyFailure(error) });
      }
    })();
    return () => {
      current = false;
    };
  }, [press, attempt, found]);

  // After Try again brings places, the first one takes the focus the button had.
  useEffect(() => {
    if (lookup.kind === "loading" || !retried.current) return;
    retried.current = false;
    if (lookup.kind === "done" && lookup.rows.length > 0) {
      body.current?.querySelector<HTMLElement>("[data-place]")?.focus();
    }
  }, [lookup]);

  const retry = () => {
    // One lookup at a time for a press.
    if (lookup.kind === "loading") return;
    retried.current = true;
    setAttempt((n) => n + 1);
  };

  const save = async (target: { listId: string | null } | { newListName: string }) => {
    if (!chosen || savingNow.current) return;
    const token = pressToken.current;
    savingNow.current = true;
    setSaving(true);
    setFailed(false);
    // Nothing of it is sent while its Undo is offered.
    const release = holdPushes(currentDb());
    try {
      const saved = await savePlaceToList(
        "newListName" in target
          ? { result: chosen.result, listId: null, newListName: target.newListName }
          : { result: chosen.result, listId: target.listId },
      );
      // A place waiting for one of her Kakao lists goes to Kakao Map once its Undo is over (where
      // the extension is; elsewhere it waits). An undone save leaves nothing to push.
      const db = currentDb();
      const done = saved.kakaoAddId
        ? () => {
            release();
            void import("../lists/pushKakaoAdds").then(({ pushKakaoAdds }) => pushKakaoAdds(db));
          }
        : release;
      if (token !== pressToken.current) return done();
      navigate(`/places/${encodeURIComponent(saved.placeId)}`, {
        replace: switchesPlace(location),
      });
      if (onSaved) onSaved(saved, done);
      else done();
      onClose();
    } catch {
      release();
      if (token !== pressToken.current) return;
      savingNow.current = false;
      setFailed(true);
      setSaving(false);
    }
  };

  const back = () => {
    if (savingNow.current) return;
    // A found place has no other places to go back to.
    if (found) {
      close();
      return;
    }
    setChosen(null);
    setNaming(false);
    setFailed(false);
  };

  const distance = (m: number) =>
    m >= 1000
      ? t("map.save.distanceKm", { km: (m / 1000).toFixed(1) })
      : t("map.save.distance", { m });

  const states = lookup.kind === "done" ? lookup.states : null;
  const chosenState = chosen ? states?.get(idOf(chosen)) : undefined;
  const newName = name.trim();
  const nothing = lookup.kind === "done" && lookup.rows.length === 0;

  // One region, always there, says what changed in a few words; the list isn't in it.
  let status = "";
  if (chosen) status = saving ? t("map.save.saving") : "";
  else if (lookup.kind === "loading") status = t("map.save.looking");
  else if (lookup.kind === "failed") status = t(FAILURE_KEY[lookup.why]);
  else if (nothing) status = t("map.save.none");
  else status = t("map.save.found", { count: lookup.rows.length });
  // On the places step, looking, a failure and nothing found are also what she sees.
  const statusShown = !chosen && (lookup.kind !== "done" || nothing);
  const statusRegion = (
    <p
      role="status"
      className={
        !statusShown ? "mm-visually-hidden" : lookup.kind === "failed" ? "mm-note" : "mm-muted"
      }
    >
      {mounted ? status : ""}
    </p>
  );

  const canRetry =
    lookup.kind === "failed" || nothing || (lookup.kind === "loading" && attempt > 0);
  const places = (
    <>
      {canRetry && (
        <button
          type="button"
          className="mm-button mm-button--secondary mm-map-menu__retry"
          aria-disabled={lookup.kind === "loading" || undefined}
          onClick={retry}
        >
          {t("map.save.retry")}
        </button>
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
                    <span className="mm-map-menu__distance">{distance(row.distanceM)}</span>
                    {saved && <span className="mm-badge">{t("map.save.saved")}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  // While saving, the controls stay focusable (aria-disabled; the guards above ignore them).
  const busy = saving || undefined;
  // Her own Kakao lists, for a place Kakao Map can add by its id.
  const kakaoLists =
    chosen && chosen.result.provider === "kakao" && isKakaoPlaceKey(chosen.result.externalId)
      ? (lists?.kakaoTargets ?? [])
      : [];
  const listStep = chosen && (
    <div className="mm-map-menu__step">
      <div className="mm-map-menu__chosen">
        <button type="button" className="mm-icon-button" aria-disabled={busy} onClick={back}>
          <ArrowLeft aria-hidden size={20} strokeWidth={1.75} />
          <span className="mm-visually-hidden">{t("map.save.back")}</span>
        </button>
        <span className="mm-hit__title">{chosen.result.title}</span>
        {chosenState?.saved && <span className="mm-badge">{t("map.save.saved")}</span>}
      </div>
      <p id={chooseId} className="mm-field__label">
        {t("map.save.chooseList")}
      </p>
      <ul className="mm-map-menu__list mm-map-menu__list--mine" aria-labelledby={chooseId}>
        {(lists?.mine ?? []).map(({ list }) => {
          const inIt = chosenState?.listIds.has(list.id) ?? false;
          return (
            <li key={list.id}>
              <button
                type="button"
                className="mm-map-menu__row"
                aria-disabled={busy}
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
            aria-expanded={naming}
            aria-disabled={busy}
            onClick={() => {
              if (!savingNow.current) setNaming((v) => !v);
            }}
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
            disabled={!newName}
            aria-disabled={busy}
          >
            {saving ? t("map.save.saving") : t("map.save.confirm")}
          </button>
        </form>
      )}
      {kakaoLists.length > 0 && (
        <div className="mm-map-menu__kakao">
          <p id={kakaoId} className="mm-field__label">
            {t("map.save.kakaoLists")}
          </p>
          <ul className="mm-map-menu__list mm-map-menu__list--kakao" aria-labelledby={kakaoId}>
            {kakaoLists.map((list) => {
              const inIt = chosenState?.listIds.has(list.id) ?? false;
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    className="mm-map-menu__row"
                    aria-disabled={busy}
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
          </ul>
        </div>
      )}
      {/* Apart from her lists: saving with no list at all. */}
      <ul className="mm-map-menu__list mm-map-menu__list--apart">
        <li>
          <button
            type="button"
            className="mm-map-menu__row"
            aria-disabled={busy}
            onClick={() => void save({ listId: null })}
          >
            <span className="mm-map-menu__text">
              <span className="mm-map-menu__name">{t("map.save.noList")}</span>
            </span>
          </button>
        </li>
      </ul>
      {/* Seen, not read: the status region above says it. */}
      {saving && !naming && (
        <p className="mm-muted" aria-hidden>
          {t("map.save.saving")}
        </p>
      )}
      {failed && (
        <p className="mm-error" role="alert">
          {t("map.save.saveFailed")}
        </p>
      )}
    </div>
  );

  const content = (
    <div ref={body} className="mm-map-menu__body">
      {statusRegion}
      {listStep || places}
    </div>
  );
  const close = () => {
    pressToken.current += 1;
    onClose();
  };
  const title = t(found ? "map.save.titleFound" : "map.save.title");
  // Escape on the lists is a step back to the places; on the places it closes.
  const onEscape = chosen ? back : undefined;
  return layout === "phone" ? (
    <Sheet title={title} onClose={close} onEscape={onEscape}>
      {content}
    </Sheet>
  ) : (
    <Popover at={press.at} title={title} onClose={close} onEscape={onEscape}>
      {content}
    </Popover>
  );
}
