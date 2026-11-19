import { LIMITS } from "@magomap/domain/limits";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useId, useRef, useState } from "react";
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
 * Writing a visit note. What's typed is kept as a draft (half a second after typing stops), so
 * an app killed mid-sentence, or an editor closed by accident, gives it back.
 */
export function NoteEditor({ placeId, note, onDone }: Props) {
  const { t } = useTranslation();
  const key = note ? `edit:${note.id}` : `new:${placeId}`;
  const draft = useLiveQuery(() => currentDb().drafts.get(key), [key], null);
  const [visitedOn, setVisitedOn] = useState(note?.visitedOn ?? localToday());
  const [body, setBody] = useState(note?.body ?? "");
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);
  const dateId = useId();
  const bodyId = useId();

  // Bring back an unsaved draft once it has loaded (unless typing already started).
  useEffect(() => {
    if (draft && !touched.current) {
      setVisitedOn(draft.visitedOn ?? "");
      setBody(draft.body);
      setRestored(true);
    }
  }, [draft]);

  useEffect(() => {
    if (!touched.current) return;
    const timer = setTimeout(
      () => void saveDraft(key, { visitedOn: visitedOn || null, body }),
      500,
    );
    return () => clearTimeout(timer);
  }, [key, visitedOn, body]);

  const tooLong = body.length > LIMITS.noteBody;
  const save = async () => {
    if (!body.trim() || tooLong) return;
    setSaving(true);
    const value = { visitedOn: visitedOn || null, body: body.trim() };
    if (note) await editVisitNote(note.id, value);
    else await addVisitNote(placeId, value);
    await clearDraft(key);
    setSaving(false);
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
        id={bodyId}
        className="mm-input mm-editor__body"
        rows={6}
        value={body}
        aria-invalid={tooLong || undefined}
        onChange={(e) => {
          touched.current = true;
          setBody(e.target.value);
        }}
      />
      {tooLong && (
        <p className="mm-error" role="alert">
          {t("place.tooLong")}
        </p>
      )}
      <div className="mm-editor__actions">
        <button
          type="button"
          className="mm-button mm-button--tertiary"
          onClick={() => {
            // Closing keeps the draft; only saving clears it.
            onDone();
          }}
        >
          {t("place.cancel")}
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
