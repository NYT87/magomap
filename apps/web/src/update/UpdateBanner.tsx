import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppUpdate } from "./useAppUpdate";

/** A new version is waiting: say so, once, and let her choose when. Quiet otherwise. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { waiting, dismissed, update, dismiss } = useAppUpdate();
  return (
    <div role="status" className="mm-update-slot">
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
            onClick={dismiss}
          >
            {t("update.later")}
          </button>
        </div>
      )}
    </div>
  );
}
