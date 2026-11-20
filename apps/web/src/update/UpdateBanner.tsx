import { RefreshCw } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppUpdate } from "./useAppUpdate";

/** A new version is waiting: say so, once, and let her choose when. Quiet otherwise. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { waiting, dismissed, update, dismiss } = useAppUpdate();
  const slot = useRef<HTMLDivElement>(null);
  return (
    // tabIndex -1: focus can rest here when "Later" removes the buttons, instead of falling to <body>.
    <div role="status" className="mm-update-slot" ref={slot} tabIndex={-1}>
      {waiting && !dismissed && (
        <div className="mm-update">
          <RefreshCw aria-hidden className="mm-update__icon" size={16} strokeWidth={2} />
          <span className="mm-update__text">{t("update.ready")}</span>
          <button type="button" className="mm-update__button" onClick={() => void update()}>
            {t("update.now")}
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
        </div>
      )}
    </div>
  );
}
