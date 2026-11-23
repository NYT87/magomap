import { LIMITS } from "@magomap/domain/limits";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoteError, setKakaoNote } from "./setKakaoNote";

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
  const box = useRef<HTMLTextAreaElement>(null);
  // A second click before the first finishes must not send a second change.
  const working = useRef(false);
  const boxId = useId();
  const errorId = useId();

  useEffect(() => {
    box.current?.focus();
  }, []);

  const save = () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setKakaoNote({ itemId, note: text }).then(
      () => {
        working.current = false;
        setBusy(false);
        onDone();
      },
      (e) => {
        working.current = false;
        setBusy(false);
        setError(e instanceof NoteError ? e.code : "kakao_unavailable");
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
        disabled={busy}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mm-note-editor__actions">
        <button type="submit" className="mm-button mm-button--primary" disabled={busy}>
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
