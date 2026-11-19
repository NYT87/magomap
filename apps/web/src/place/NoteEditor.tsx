import { LIMITS } from "@magomap/domain/limits";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentDb } from "../data/db";
import { addVisitNote, clearDraft, editVisitNote, saveDraft } from "../data/writes";

/** Today in the device's own time zone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Props {
  placeId: string;
  /** Editing an existing note; otherwise a new one. */
  note?: { id: string; visitedOn: string | null; body: string };
  onDone: () => void;
}

/**
 * Writing a visit note. What's typed is kept as a draft half a second after typing stops, and at
 * once when the app is hidden or the editor closes, so a phone that discards the app mid-sentence
 * gives it back.
 */
export function NoteEditor({ placeId, note, onDone }: Props) {
  const { t } = useTranslation();
  const key = note ? `edit:${note.id}` : `new:${placeId}`;
  const draft = useLiveQuery(() => currentDb().drafts.get(key), [key], null);
  const [visitedOn, setVisitedOn] = useState(note?.visitedOn ?? localToday());
  const [body, setBody] = useState(note?.body ?? "");
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const touched = useRef(false);
  const unsaved = useRef<{ visitedOn: string | null; body: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dateId = useId();
  const bodyId = useId();
  const errorId = useId();

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  // Bring back an unsaved draft once it has loaded (unless typing already started).
  useEffect(() => {
    if (draft && !touched.current) {
      setVisitedOn(draft.visitedOn ?? "");
      setBody(draft.body);
      setRestored(true);
    }
  }, [draft]);

  const flush = useCallback(() => {
    const value = unsaved.current;
    if (!value) return;
    unsaved.current = null;
    void saveDraft(key, value);
  }, [key]);

  useEffect(() => {
    if (!touched.current) return;
    unsaved.current = { visitedOn: visitedOn || null, body };
    const timer = setTimeout(flush, 500);
    return () => clearTimeout(timer);
  }, [visitedOn, body, flush]);

  // Hidden (switching apps, locking the phone) or closing: keep what's typed right away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const tooLong = body.length > LIMITS.noteBody;
  const save = async () => {
    if (!body.trim() || tooLong) return;
    setSaving(true);
    setFailed(false);
    try {
      const value = { visitedOn: visitedOn || null, body: body.trim() };
      if (note) await editVisitNote(note.id, value);
      else await addVisitNote(placeId, value);
      unsaved.current = null;
      await clearDraft(key);
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    unsaved.current = null;
    await clearDraft(key);
    onDone();
  };

  return (
    <form
      className="mm-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {restored && <p className="mm-muted">{t("place.draftRestored")}</p>}
      <label className="mm-field" htmlFor={dateId}>
        <span className="mm-field__label">{t("place.date")}</span>
      </label>
      <input
        id={dateId}
        className="mm-input mm-input--date"
        type="date"
        value={visitedOn}
        max={localToday()}
        onChange={(e) => {
          touched.current = true;
          setVisitedOn(e.target.value);
        }}
      />
      <label className="mm-field" htmlFor={bodyId}>
        <span className="mm-field__label">{t("place.note")}</span>
      </label>
      <textarea
        ref={textarea}
        id={bodyId}
        className="mm-input mm-editor__body"
        rows={6}
        value={body}
        required
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong || failed ? errorId : undefined}
        onChange={(e) => {
          touched.current = true;
          setBody(e.target.value);
        }}
      />
      {(tooLong || failed) && (
        <p className="mm-error" role="alert" id={errorId}>
          {tooLong ? t("place.tooLong") : t("place.saveFailed")}
        </p>
      )}
      <p className="mm-muted">{t("place.draftKept")}</p>
      <div className="mm-editor__actions">
        {(restored || body.trim().length > 0) && (
          <button
            type="button"
            className="mm-button mm-button--danger-text mm-editor__discard"
            onClick={() => void discard()}
          >
            {t("place.discardDraft")}
          </button>
        )}
        <button type="button" className="mm-button mm-button--tertiary" onClick={onDone}>
          {t("place.close")}
        </button>
        <button
          type="submit"
          className="mm-button mm-button--primary"
          disabled={saving || !body.trim() || tooLong}
        >
          {t("place.saveNote")}
        </button>
      </div>
    </form>
  );
}
