import { AlertTriangle, Check, CloudOff, Loader, LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { accountName } from "../auth/useMe";
import type { RejectedEntry } from "../data/db";
import { currentDb, dbUserId, openDbOrNull } from "../data/db";
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
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const online = useOnline();
  const [sheet, setSheet] = useState<"sync" | "rejected" | null>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Back to the icon whenever the sheets close, also when one sheet replaces the other.
  useEffect(() => {
    if (sheet === null && wasOpen.current) iconRef.current?.focus();
    wasOpen.current = sheet !== null;
  }, [sheet]);
  const n = status.unsynced;

  const size = compact ? 20 : 16;
  let tone: "ok" | "busy" | "warn" | "error" = "ok";
  let icon = <Check aria-hidden size={size} strokeWidth={2} />;
  let text = t("sync.synced");
  if (!online || status.state === "offline") {
    tone = "warn";
    icon = <CloudOff aria-hidden size={size} strokeWidth={2} />;
    text = n > 0 ? t("sync.offlineSaved", { count: n }) : t("sync.offline");
  } else if (status.state === "needs_signin") {
    tone = "warn";
    icon = <LogIn aria-hidden size={size} strokeWidth={2} />;
    // Name the account whose data this device holds, so it's clear who should sign in.
    const db = openDbOrNull();
    const name = db ? accountName(dbUserId(db)) : null;
    if (name) {
      text =
        n > 0 ? t("sync.needsSigninAs", { count: n, name }) : t("sync.needsSigninAsNone", { name });
    } else {
      text = n > 0 ? t("sync.needsSignin", { count: n }) : t("sync.needsSigninNone");
    }
  } else if (status.state === "error") {
    tone = "warn";
    icon = <CloudOff aria-hidden size={size} strokeWidth={2} />;
    text = t("sync.error");
  } else if (status.state === "clock_ahead") {
    tone = "warn";
    icon = <AlertTriangle aria-hidden size={size} strokeWidth={2} />;
    text = t("sync.clockAhead");
  } else if (status.state === "syncing" || n > 0) {
    tone = "busy";
    icon = <Loader aria-hidden size={size} strokeWidth={2} />;
    text = t("sync.syncing");
  }

  // The icon's name carries what the dot and the count badge show by colour and shape.
  const counted =
    n > 0 && (!online || status.state === "offline" || status.state === "needs_signin");
  const refused = status.rejected > 0 ? t("sync.rejected", { count: status.rejected }) : "";
  const join = (parts: string[]) =>
    parts.reduce((all, part) => (/[….]$/.test(all) ? `${all} ${part}` : `${all}. ${part}`));
  // The live region speaks the status and refused changes only: the waiting count would be
  // re-announced on every change while syncing. The button's name has all of it.
  const spoken = join([text, ...(refused ? [refused] : [])]);
  const label = join([
    text,
    ...(n > 0 && !counted ? [t("sync.waiting", { count: n })] : []),
    ...(refused ? [refused] : []),
  ]);

  // States that need her, not ones that mend themselves (offline): a stronger signal on the icon.
  const needsHer = ["needs_signin", "error", "clock_ahead"].includes(status.state) && online;

  if (compact) {
    return (
      <div className="mm-sync mm-sync--compact">
        {/* The same live region as below: it stays mounted, so every change is announced. */}
        <span className="mm-visually-hidden" role="status">
          {spoken}
        </span>
        <button
          type="button"
          ref={iconRef}
          className="mm-sync__icon"
          data-tone={tone}
          data-attention={needsHer || undefined}
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => setSheet("sync")}
        >
          {icon}
          {status.rejected > 0 && <span className="mm-sync__dot" aria-hidden />}
          {n > 0 && (
            <span className="mm-sync__count" aria-hidden>
              {n > 9 ? "9+" : n}
            </span>
          )}
        </button>
        {sheet === "sync" && (
          <Sheet title={t("sync.title")} onClose={() => setSheet(null)}>
            <div className="mm-sync__sheet">
              {/* The page behind a sheet is inert, so its live region is silent: announce here. */}
              <p role="status">{text}</p>
              {status.state === "needs_signin" && (
                <a href="/api/auth/kakao/start" className="mm-sync__pill mm-sync__pill--action">
                  <LogIn aria-hidden size={16} strokeWidth={2} />
                  {t("sync.signIn")}
                </a>
              )}
              {status.rejected > 0 && (
                <button
                  type="button"
                  className="mm-sync__pill"
                  data-tone="error"
                  onClick={() => setSheet("rejected")}
                >
                  <AlertTriangle aria-hidden size={16} strokeWidth={2} />
                  {t("sync.rejected", { count: status.rejected })}
                </button>
              )}
            </div>
          </Sheet>
        )}
        {sheet === "rejected" && <RejectedSheet onClose={() => setSheet(null)} />}
      </div>
    );
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
          onClick={() => setSheet("rejected")}
        >
          <AlertTriangle aria-hidden size={size} strokeWidth={2} />
          {t("sync.rejected", { count: status.rejected })}
        </button>
      )}
      {sheet === "rejected" && <RejectedSheet onClose={() => setSheet(null)} />}
    </div>
  );
}
