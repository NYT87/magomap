import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/** A bottom sheet on phones: modal, Esc or the scrim closes it, focus returns afterwards. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="mm-sheet-host">
      <button
        type="button"
        className="mm-sheet-scrim"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
      />
      <div
        ref={ref}
        className="mm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <div className="mm-sheet__head">
          <h2 id={id} className="mm-h4">
            {title}
          </h2>
          <button type="button" className="mm-icon-button" onClick={onClose}>
            <X aria-hidden size={20} strokeWidth={1.75} />
            <span className="mm-visually-hidden">{t("map.close")}</span>
          </button>
        </div>
        <div className="mm-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
