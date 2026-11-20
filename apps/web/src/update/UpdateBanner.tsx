import { RefreshCw } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppUpdate } from "./useAppUpdate";

/** A new version is waiting: say so, once, and let her choose when. Quiet otherwise. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { waiting, updating, dismissed, update, dismiss } = useAppUpdate();
  const slot = useRef<HTMLDivElement>(null);
  const shown = waiting && !dismissed;
  return (
    // tabIndex -1: focus can rest here when "Later" removes the buttons, instead of falling to <body>.
    <div className="mm-update-slot" ref={slot} tabIndex={-1}>
      <div className={shown ? "mm-update" : undefined}>
        {shown && <RefreshCw aria-hidden className="mm-update__icon" size={16} strokeWidth={2} />}
        {/* Always present, so the message is announced when it appears. Only the message: the
            buttons sit outside the live region. */}
        <span role="status" className={shown ? "mm-update__text" : undefined}>
          {shown && (updating ? t("update.updating") : t("update.ready"))}
        </span>
        {shown && (
          <>
            <button
              type="button"
              className="mm-update__button"
              aria-disabled={updating || undefined}
              onClick={() => void update()}
            >
              {updating ? t("update.updating") : t("update.now")}
            </button>
            <button
              type="button"
              className="mm-update__button mm-update__button--quiet"
              onClick={() => {
                slot.current?.focus();
                dismiss();
              }}
            >
              {t("update.later")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
