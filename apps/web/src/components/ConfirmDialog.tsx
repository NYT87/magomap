import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useInertBackground } from "./useInertBackground";

interface Props {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onCancel: () => void;
  /** "dialog" for a form; "alertdialog" (default) for a confirmation. */
  role?: "dialog" | "alertdialog";
}

/** A small modal confirmation: focus moves in, Esc cancels, focus returns on close. */
export function ConfirmDialog({ title, children, actions, onCancel, role = "alertdialog" }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useInertBackground();
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
  const content = (
    <>
      <h2 id={titleId} className="mm-dialog__title">
        {title}
      </h2>
      <div className="mm-dialog__body">{children}</div>
      {actions && <div className="mm-dialog__actions">{actions}</div>}
    </>
  );
  return createPortal(
    <div className="mm-scrim">
      {role === "dialog" ? (
        <div
          ref={ref}
          className="mm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {content}
        </div>
      ) : (
        <div
          ref={ref}
          className="mm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {content}
        </div>
      )}
    </div>,
    document.body,
  );
}
