import type { ListRow } from "@magomap/domain";
import { LIMITS } from "@magomap/domain/limits";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { duplicateList } from "../data/writes";

/** "<name> (copy)", with the name clipped so the whole fits the list name limit. */
function defaultCopyName(t: (key: string, o: { name: string }) => string, name: string): string {
  const chars = [...name];
  let full = t("lists.duplicate.defaultName", { name });
  while (full.length > LIMITS.listName && chars.length > 0) {
    chars.pop();
    full = t("lists.duplicate.defaultName", { name: chars.join("") });
  }
  return full;
}

/** Names a copy of `list` and makes it as a new own list in magomap, then opens it. */
export function DuplicateDialog({ list, onClose }: { list: ListRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [name, setName] = useState(() => defaultCopyName(t, list.name));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A second tap before the first finishes must not make a second list.
  const working = useRef(false);
  const nameId = useId();
  const blank = !name.trim();

  const copy = () => {
    if (working.current || blank) return;
    working.current = true;
    setBusy(true);
    setFailed(false);
    duplicateList(list.id, name).then(
      (id) => {
        navigate(`/lists/${encodeURIComponent(id)}`);
        onClose();
      },
      () => {
        working.current = false;
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <ConfirmDialog
      title={t("lists.duplicate.title", { name: list.name })}
      role="dialog"
      onCancel={onClose}
      actions={
        <>
          <button type="button" className="mm-button mm-button--secondary" onClick={onClose}>
            {t("lists.duplicate.cancel")}
          </button>
          <button
            type="button"
            className="mm-button mm-button--primary"
            disabled={blank || busy}
            onClick={copy}
          >
            {t("lists.duplicate.copyHere")}
          </button>
        </>
      }
    >
      <div className="mm-stack">
        <label className="mm-field" htmlFor={nameId}>
          <span className="mm-field__label">{t("lists.duplicate.name")}</span>
        </label>
        <input
          id={nameId}
          className="mm-input"
          value={name}
          maxLength={LIMITS.listName}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              copy();
            }
          }}
        />
        {failed && (
          <p role="alert" className="mm-error">
            {t("lists.duplicate.failed")}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
