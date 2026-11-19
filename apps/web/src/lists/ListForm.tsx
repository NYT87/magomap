import { LIMITS } from "@magomap/domain/limits";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { LIST_COLORS } from "./colors";

/** Name and one of the 8 colours; used to create and to edit an own list. */
export function ListForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; color: string | null };
  submitLabel: string;
  onSubmit: (v: { name: string; color: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<string>(initial?.color ?? LIST_COLORS[0].value);
  const nameId = useId();
  return (
    <form
      className="mm-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit({ name: name.trim(), color });
      }}
    >
      <label className="mm-field" htmlFor={nameId}>
        <span className="mm-field__label">{t("lists.name")}</span>
      </label>
      <input
        id={nameId}
        className="mm-input"
        value={name}
        maxLength={LIMITS.listName}
        required
        onChange={(e) => setName(e.target.value)}
      />
      <fieldset className="mm-colors">
        <legend className="mm-field__label">{t("lists.color")}</legend>
        {LIST_COLORS.map((c) => (
          <label key={c.key} className="mm-color">
            <input
              type="radio"
              name="color"
              value={c.value}
              checked={color.toUpperCase() === c.value}
              onChange={() => setColor(c.value)}
            />
            <span className="mm-color__dot" style={{ background: c.value }} aria-hidden />
            <span className="mm-visually-hidden">{t(`lists.colors.${c.key}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className="mm-dialog__actions">
        <button type="button" className="mm-button mm-button--secondary" onClick={onCancel}>
          {t("lists.cancel")}
        </button>
        <button type="submit" className="mm-button mm-button--primary" disabled={!name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
