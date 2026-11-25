import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { type SavedFromMap, undoSave } from "../data/saveFromMap";

/** How long the confirmation stays when she isn't on it. */
export const SAVE_CONFIRMATION_MS = 6_000;

/**
 * After a save from the map: "Saved to <list>" (or "Saved"), with Undo when the save changed
 * anything. A polite status; it goes away after a few seconds (not while her pointer or focus is
 * on it), on her next action elsewhere, or when a newer save replaces it. Going away lets the
 * held sending go (`release`). Undo takes back exactly what the save did; when that unsaves the
 * place she landed on, she goes back to the map.
 */
export function SaveConfirmation({
  saved,
  release,
  onDone,
}: {
  saved: SavedFromMap;
  release: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [on, setOn] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Whatever ends it, sending goes on.
  useEffect(() => release, [release]);

  useEffect(() => {
    if (on || undoing) return;
    const timer = setTimeout(() => doneRef.current(), SAVE_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [on, undoing]);

  // While her pointer or focus is on it, it stays.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const enter = () => setOn(true);
    const leave = () => setOn(false);
    const focusOut = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) setOn(false);
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("focusin", enter);
    el.addEventListener("focusout", focusOut);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("focusin", enter);
      el.removeEventListener("focusout", focusOut);
    };
  }, []);

  // Her next action elsewhere ends it (moving focus with Tab, toward Undo, doesn't).
  useEffect(() => {
    const outside = (e: Event) => !(e.target instanceof Node && ref.current?.contains(e.target));
    const onDown = (e: PointerEvent) => {
      if (outside(e)) doneRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (["Tab", "Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (outside(e)) doneRef.current();
    };
    document.addEventListener("pointerdown", onDown, { capture: true });
    document.addEventListener("keydown", onKey, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);

  const undo = async () => {
    if (undoing) return;
    setUndoing(true);
    setFailed(false);
    try {
      await undoSave(saved);
      const unsaved = saved.rows.some((r) => r.table === "user_places");
      if (unsaved && location === `/places/${encodeURIComponent(saved.placeId)}`) {
        navigate("/", { replace: true });
      }
      doneRef.current();
    } catch {
      setFailed(true);
      setUndoing(false);
    }
  };

  const text = saved.listName
    ? t("map.save.savedTo", { list: saved.listName })
    : t("map.save.savedNoList");
  return createPortal(
    <div ref={ref} className="mm-save-confirmation">
      <p role="status" className="mm-save-confirmation__text">
        {failed ? t("map.save.undoFailed") : text}
      </p>
      {saved.changed && (
        <button
          type="button"
          className="mm-button mm-button--secondary mm-button--small"
          aria-disabled={undoing || undefined}
          onClick={() => void undo()}
        >
          {t("map.save.undo")}
        </button>
      )}
    </div>,
    document.body,
  );
}
