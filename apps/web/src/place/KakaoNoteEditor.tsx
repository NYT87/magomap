import { LIMITS } from "@magomap/domain/limits";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoteChangedError, NoteError, setKakaoNote } from "./setKakaoNote";

const errorKey = (code: string) =>
  ({
    extension_missing: "place.kakaoNoteEdit.errExtension",
    account_mismatch: "place.kakaoNoteEdit.errAccount",
    account_unconfirmed: "place.kakaoNoteEdit.errUnconfirmed",
    kakao_signed_out: "place.kakaoNoteEdit.errSignedOut",
    not_found: "place.kakaoNoteEdit.errNotFound",
    not_owner: "place.kakaoNoteEdit.errNotOwner",
    busy: "place.kakaoNoteEdit.errBusy",
    offline: "place.kakaoNoteEdit.errOffline",
    too_long: "place.kakaoNoteEdit.errTooLong",
    server_failed: "place.kakaoNoteEdit.errServer",
  })[code] ?? "place.kakaoNoteEdit.errUnavailable";

/**
 * A box to change one place's Kakao note in one list. Save changes it in Kakao Map first, then
 * in magomap; a failure says why and keeps what was typed. Enter adds a line (only the Save
 * button saves) and Escape cancels, so no stray key changes the note.
 */
export function KakaoNoteEditor({
  itemId,
  listName,
  current,
  onDone,
}: {
  itemId: string;
  listName: string;
  /** The note as magomap has it now (empty when none). */
  current: string;
  /** Called when it closes, saved or cancelled. */
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kakao Map's note, when it was changed there since the last sync (shown before overwriting it).
  const [changed, setChanged] = useState<string | null>(null);
  const warning = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // A second click before the first finishes must not send a second change.
  const working = useRef(false);
  const boxId = useId();
  const errorId = useId();
  const warningTitleId = useId();
  const warningBodyId = useId();

  useEffect(() => {
    box.current?.focus();
  }, []);

  // Moves to the warning when it appears, so a screen reader reads it.
  useEffect(() => {
    if (changed !== null) warning.current?.focus();
  }, [changed]);

  const save = (overwrite = false) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setChanged(null);
    setKakaoNote({ itemId, note: text, ...(overwrite ? { overwrite: true } : {}) }).then(
      () => {
        working.current = false;
        setBusy(false);
        onDone();
      },
      (e) => {
        working.current = false;
        setBusy(false);
        if (e instanceof NoteChangedError) setChanged(e.current);
        else setError(e instanceof NoteError ? e.code : "kakao_unavailable");
      },
    );
  };
  const cancel = () => {
    if (!working.current) onDone();
  };

  return (
    <form
      className="mm-note-editor"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <label htmlFor={boxId} className="mm-visually-hidden">
        {t("place.kakaoNoteEdit.label", { name: listName })}
      </label>
      <textarea
        id={boxId}
        ref={box}
        className="mm-input mm-note-editor__box"
        rows={4}
        maxLength={LIMITS.importText}
        value={text}
        disabled={busy || changed !== null}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      {changed !== null && (
        <div
          ref={warning}
          role="alertdialog"
          tabIndex={-1}
          aria-labelledby={warningTitleId}
          aria-describedby={warningBodyId}
          className="mm-card mm-note-editor__warning"
        >
          <p id={warningTitleId} className="mm-note-editor__warning-title">
            {t("place.kakaoNoteEdit.changedTitle")}
          </p>
          <p id={warningBodyId}>
            {changed.trim() ? (
              <>
                {t("place.kakaoNoteEdit.changedNow")}
                <q className="mm-note-editor__theirs">{changed}</q>
              </>
            ) : (
              t("place.kakaoNoteEdit.changedNowEmpty")
            )}
          </p>
          <p>{t("place.kakaoNoteEdit.changedWarning")}</p>
          <div className="mm-note-editor__actions">
            <button
              type="button"
              className="mm-button mm-button--primary"
              onClick={() => save(true)}
            >
              {t("place.kakaoNoteEdit.overwrite")}
            </button>
            <button
              type="button"
              className="mm-button mm-button--secondary"
              onClick={() => setChanged(null)}
            >
              {t("place.kakaoNoteEdit.keepEditing")}
            </button>
          </div>
        </div>
      )}
      <div className="mm-note-editor__actions">
        <button
          type="submit"
          className="mm-button mm-button--primary"
          disabled={busy || changed !== null}
        >
          {t("place.kakaoNoteEdit.save")}
        </button>
        <button
          type="button"
          className="mm-button mm-button--secondary"
          disabled={busy}
          onClick={cancel}
        >
          {t("place.kakaoNoteEdit.cancel")}
        </button>
      </div>
      <p role="status" className="mm-muted mm-note-editor__status">
        {busy ? t("place.kakaoNoteEdit.saving") : ""}
      </p>
      {error && (
        <p id={errorId} role="alert" className="mm-error">
          {t(errorKey(error))}
        </p>
      )}
    </form>
  );
}
