import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onCancel: () => void;
}

/** A small modal confirmation: focus moves in, Esc cancels, focus returns on close. */
export function ConfirmDialog({ title, children, actions, onCancel }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onCancel]);
  return createPortal(
    <div className="mm-scrim">
      <div
        ref={ref}
        className="mm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="mm-dialog__title">
          {title}
        </h2>
        <div className="mm-dialog__body">{children}</div>
        <div className="mm-dialog__actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
