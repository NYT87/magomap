import { AlertTriangle, Check, CloudOff, Loader, LogIn } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RejectedEntry } from "../data/db";
import { currentDb } from "../data/db";
import { dismissRejected, useRejected } from "../data/queries";
import { useSyncStatus } from "../data/useSyncStatus";
import { useOnline } from "../import/useOnline";
import { Sheet } from "./Sheet";

const KIND: Record<RejectedEntry["table"], string> = {
  visit_notes: "sync.note",
  links: "sync.link",
  lists: "sync.list",
  places: "sync.place",
  list_items: "sync.membership",
};

/** The text worth keeping from a refused change. */
function textOf(e: RejectedEntry): string {
  const row = (e.row ?? {}) as Record<string, unknown>;
  for (const key of ["body", "url", "name", "title"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  return "";
}

function RejectedSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rejected = useRejected() ?? [];
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Sheet title={t("sync.rejectedTitle")} onClose={onClose}>
      <p className="mm-muted">{t("sync.rejectedLead")}</p>
      <p className="mm-muted">{t("sync.dismissHint")}</p>
      <ul className="mm-rejected">
        {rejected.map((e) => {
          const text = textOf(e);
          return (
            <li key={e.mutationId} className="mm-rejected__item">
              <span className="mm-picker__title">
                {e.op === "delete" ? t("sync.deleted") : t(KIND[e.table])}
              </span>
              {text && <p className="mm-entry__body">{text}</p>}
              <span className="mm-entry__actions">
                {text && (
                  <button
                    type="button"
                    className="mm-link-button"
                    onClick={() =>
                      void navigator.clipboard?.writeText(text).then(() => setCopied(e.mutationId))
                    }
                  >
                    {copied === e.mutationId ? t("sync.copied") : t("sync.copy")}
                  </button>
                )}
                <button
                  type="button"
                  className="mm-link-button"
                  onClick={() => void dismissRejected(currentDb(), e.mutationId)}
                >
                  {t("sync.dismiss")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/** One calm line about whether her changes are safe and on the server. */
export function SyncIndicator() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const online = useOnline();
  const [sheet, setSheet] = useState(false);
  const n = status.unsynced;

  let tone: "ok" | "busy" | "warn" | "error" = "ok";
  let icon = <Check aria-hidden size={16} strokeWidth={2} />;
  let text = t("sync.synced");
  if (!online || status.state === "offline") {
    tone = "warn";
    icon = <CloudOff aria-hidden size={16} strokeWidth={2} />;
    text = n > 0 ? t("sync.offlineSaved", { count: n }) : t("sync.offline");
  } else if (status.state === "needs_signin") {
    tone = "warn";
    icon = <LogIn aria-hidden size={16} strokeWidth={2} />;
    text = n > 0 ? t("sync.needsSignin", { count: n }) : t("sync.needsSigninNone");
  } else if (status.state === "error") {
    tone = "warn";
    icon = <CloudOff aria-hidden size={16} strokeWidth={2} />;
    text = t("sync.error");
  } else if (status.state === "clock_ahead") {
    tone = "warn";
    icon = <AlertTriangle aria-hidden size={16} strokeWidth={2} />;
    text = t("sync.clockAhead");
  } else if (status.state === "syncing" || n > 0) {
    tone = "busy";
    icon = <Loader aria-hidden size={16} strokeWidth={2} />;
    text = t("sync.syncing");
  }

  return (
    <div className="mm-sync">
      {/* One live region that stays mounted, so every change of state is announced. */}
      <span className="mm-visually-hidden" role="status">
        {text}
      </span>
      {status.state === "needs_signin" ? (
        <a
          href="/api/auth/kakao/start"
          className="mm-sync__pill mm-sync__pill--action"
          data-tone={tone}
        >
          {icon}
          <span aria-hidden>{text}</span>
        </a>
      ) : (
        <span className="mm-sync__pill" data-tone={tone} aria-hidden>
          {icon}
          <span>{text}</span>
        </span>
      )}
      {status.rejected > 0 && (
        <button
          type="button"
          className="mm-sync__pill"
          data-tone="error"
          onClick={() => setSheet(true)}
        >
          <AlertTriangle aria-hidden size={16} strokeWidth={2} />
          {t("sync.rejected", { count: status.rejected })}
        </button>
      )}
      {sheet && <RejectedSheet onClose={() => setSheet(false)} />}
    </div>
  );
}
