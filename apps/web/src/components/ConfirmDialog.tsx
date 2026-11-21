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
  /** On phones, stack the actions full width (for three actions, or long labels). */
  stackActions?: boolean;
}

/** A small modal confirmation: focus moves in, Esc cancels, focus returns on close. */
export function ConfirmDialog({
  title,
  children,
  actions,
  onCancel,
  role = "alertdialog",
  stackActions = false,
}: Props) {
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useInertBackground();
  // The latest onCancel, without re-running the focus effect when a parent re-renders.
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);
  const content = (
    <>
      <h2 id={titleId} className="mm-dialog__title">
        {title}
      </h2>
      <div className="mm-dialog__body" id={bodyId}>
        {children}
      </div>
      {actions && (
        <div className={`mm-dialog__actions${stackActions ? " mm-dialog__actions--stack" : ""}`}>
          {actions}
        </div>
      )}
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
          aria-describedby={bodyId}
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
          aria-describedby={bodyId}
        >
          {content}
        </div>
      )}
    </div>,
    document.body,
  );
}
