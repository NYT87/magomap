// "Sync from Kakao Map" in Account: the magomap extension reads her Kakao Map lists in this
// browser and the sync uploads them, with its progress, summary, errors and last run.
import type { ImportRunInfo, ImportSummary, KakaoMapAccountHint, Me } from "@magomap/domain";
import type { TFunction } from "i18next";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatDateTime } from "../i18n";
import {
  currentKakaoMapJob,
  type KakaoMapJob,
  startKakaoMapJob,
  subscribeKakaoMapJob,
} from "../import/importJob";
import {
  detectExtension,
  type ExtensionState,
  forgetKakaoMapRead,
  type KakaoMapSyncCode,
  KakaoMapSyncError,
} from "../import/kakaoMap";
import { useOnline } from "../import/useOnline";
import { useLayout } from "../layout/useLayout";

/** Where the extension is published: the repo's releases tagged `extension-v…`. */
export const EXTENSION_RELEASES =
  "https://github.com/NYT87/magomap/releases?q=extension-v&expanded=true";
const KAKAO_MAP = "https://map.kakao.com";

interface ConfirmOutcome {
  kind: "confirm";
  mismatch: boolean;
  /** The account the read came from. */
  account: KakaoMapAccountHint;
  /** On a mismatch, the account she synced from before. */
  bound?: KakaoMapAccountHint;
  /** Confirming couldn't go out (the connection dropped); the dialog stays to try again. */
  error?: KakaoMapSyncCode;
}

type Outcome =
  | { kind: "none" }
  | { kind: "done"; summary: ImportSummary }
  | ConfirmOutcome
  | { kind: "failed"; code: KakaoMapSyncCode | undefined };

function errorKey(code: KakaoMapSyncCode | undefined): string {
  switch (code) {
    case "kakao_signed_out":
      return "kakaoMap.errSignedOut";
    case "kakao_unavailable":
      return "kakaoMap.errUnavailable";
    case "busy":
      return "kakaoMap.errBusy";
    case "kakao_account_taken":
      return "kakaoMap.errTaken";
    case "not_allowed":
      return "kakaoMap.errNotAllowed";
    case "kakao_account_unclear":
      return "kakaoMap.errUnclear";
    case "too_large":
      return "kakaoMap.errTooLarge";
    case "offline":
      return "kakaoMap.errOffline";
    case "signed_out":
      return "kakaoMap.errSignedOutMagomap";
    default:
      return "kakaoMap.errOther";
  }
}

/** A sync's summary in a line: what changed, or that nothing did. */
export function summaryText(t: TFunction, s: ImportSummary) {
  const parts = [
    s.placesAdded && t("kakaoMap.summaryAdded", { count: s.placesAdded }),
    s.membershipsRemoved && t("kakaoMap.summaryRemoved", { count: s.membershipsRemoved }),
    s.membershipsRestored && t("kakaoMap.summaryRestored", { count: s.membershipsRestored }),
    s.placesMoved && t("kakaoMap.summaryMoved", { count: s.placesMoved }),
    s.notesImported && t("kakaoMap.summaryNotes", { count: s.notesImported }),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("kakaoMap.nothingChanged");
}

/** An account in words: "수지's Kakao Map account ending in 1234" (no bullets to read out). */
const accountText = (t: TFunction, a: KakaoMapAccountHint) =>
  a.nickname
    ? t("kakaoMap.accountNamed", { nickname: a.nickname, idTail: a.idTail })
    : t("kakaoMap.accountTail", { idTail: a.idTail });

/** The latest run, when the server answered with one. */
const asRun = (value: unknown): ImportRunInfo | null =>
  value && typeof value === "object" && "runId" in value && "status" in value
    ? (value as ImportRunInfo)
    : null;

/** A link that opens outside magomap, saying so to screen readers. */
function OutLink({
  href,
  className,
  children,
  onClick,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={onClick}
    >
      {children}
      <span className="mm-visually-hidden"> {t("kakaoMap.newTab")}</span>
    </a>
  );
}

export function KakaoMapSyncSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const headingId = useId();
  const offlineId = useId();
  const dialogReasonId = useId();
  const online = useOnline();
  const layout = useLayout();
  const [extension, setExtension] = useState<ExtensionState | "checking">("checking");
  // The sync itself lives outside this screen, so leaving Account and coming back finds it running.
  const job = useSyncExternalStore(subscribeKakaoMapJob, currentKakaoMapJob);
  const [followed, setFollowed] = useState<KakaoMapJob | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [last, setLast] = useState<ImportRunInfo | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const following = useRef<KakaoMapJob | null>(null);
  const reads = useRef(0);
  const shown = useRef<Outcome>(outcome);
  shown.current = outcome;

  // The latest read wins: one that started before a newer one (or before a sync began) can't
  // change what is on screen when it lands.
  const readLast = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const run = asRun(await apiFetch<unknown>("/api/import/runs/latest"));
      if (reads.current === mine) setLast(run?.source === "kakao_map" ? run : null);
    } catch {
      // The last sync just stays as it was.
    }
  }, []);

  /**
   * Shows a sync's end here, whether this screen started it or came back to it. `from` is the
   * confirmation it was started from, shown again if confirming couldn't go out.
   */
  const follow = useCallback(
    async (running: KakaoMapJob, from?: ConfirmOutcome) => {
      if (following.current === running) return;
      following.current = running;
      reads.current += 1;
      setFollowed(running);
      setOutcome({ kind: "none" });
      let next: Outcome;
      try {
        next = { kind: "done", summary: await running.promise };
      } catch (error) {
        const e = error instanceof KakaoMapSyncError ? error : null;
        if (
          e?.account &&
          (e.code === "kakao_account_unconfirmed" || e.code === "kakao_account_mismatch")
        ) {
          next = {
            kind: "confirm",
            mismatch: e.code === "kakao_account_mismatch",
            account: e.account,
            ...(e.bound ? { bound: e.bound } : {}),
          };
        } else if (from && e?.code === "offline") {
          next = { ...from, error: "offline" };
        } else {
          next = { kind: "failed", code: e?.code };
        }
      }
      if (!mounted.current) {
        // No one is here to answer the confirmation: don't keep her read for it.
        if (next.kind === "confirm") forgetKakaoMapRead();
        return;
      }
      following.current = null;
      setOutcome(next);
      setFollowed(null);
      await readLast();
      if (!mounted.current || next.kind === "confirm") return;
      // Keep focus from dropping to the page when the button is re-enabled.
      const active = document.activeElement;
      const lost =
        !active ||
        active === document.body ||
        (section.current?.contains(active) &&
          active instanceof HTMLButtonElement &&
          active.disabled);
      if (lost) region.current?.focus({ preventScroll: true });
    },
    [readLast],
  );

  useEffect(() => {
    mounted.current = true;
    const running = currentKakaoMapJob();
    if (running) void follow(running);
    return () => {
      mounted.current = false;
      following.current = null;
      // Leaving with a confirmation open: the read kept for it goes too.
      if (shown.current.kind === "confirm") forgetKakaoMapRead();
    };
  }, [follow]);

  // Looks for the extension now, and again when she comes back to this tab (after installing it).
  useEffect(() => {
    let live = true;
    const check = () =>
      void detectExtension().then((state) => {
        if (live) setExtension((now) => (now === "ready" ? now : state));
      });
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (online) void readLast();
  }, [online, readLast]);

  const start = (from?: ConfirmOutcome) => {
    const started = startKakaoMapJob(from?.account.idTail);
    // The pressed button is about to be disabled (or the dialog closed): move focus to the results.
    if (section.current?.contains(document.activeElement) || from) {
      region.current?.focus({ preventScroll: true });
    }
    void follow(started, from);
  };

  const cancelConfirm = () => {
    forgetKakaoMapRead();
    setOutcome({ kind: "none" });
  };

  const active = job ?? followed;
  const running = active !== null;
  const idle = !running && outcome.kind === "none";
  const interrupted = idle && last?.status === "running";
  const ready = extension === "ready";
  const blocked = !online;
  // Why the button is off, read out with it.
  const reason = !online ? offlineId : undefined;
  const syncAction = (o: ConfirmOutcome, label: string) => (
    <button
      type="button"
      className="mm-button mm-button--primary"
      disabled={blocked}
      aria-describedby={blocked ? dialogReasonId : undefined}
      onClick={() => start(o)}
    >
      {label}
    </button>
  );
  const cancelAction = (
    <button type="button" className="mm-button mm-button--secondary" onClick={cancelConfirm}>
      {t("account.cancel")}
    </button>
  );
  return (
    <section className="mm-card mm-stack" aria-labelledby={headingId} ref={section}>
      <h2 className="mm-h4" id={headingId}>
        {t("kakaoMap.title")}
      </h2>
      <p className="mm-muted">{t("kakaoMap.lead")}</p>
      {!online && (
        <p className="mm-note" id={offlineId}>
          {t("kakaoMap.offline")}
        </p>
      )}
      {!running && extension === "checking" && <p className="mm-muted">{t("kakaoMap.checking")}</p>}
      {!running &&
        extension === "missing" &&
        (layout === "phone" ? (
          <p className="mm-note">{t("kakaoMap.missingPhone")}</p>
        ) : (
          <>
            <p className="mm-note">{t("kakaoMap.missingDesktop")}</p>
            <OutLink href={EXTENSION_RELEASES} className="mm-button mm-button--secondary">
              {t("kakaoMap.install")}
            </OutLink>
          </>
        ))}
      {/* Progress stays out of the live region: only the start and the end are announced. */}
      {running && (
        <div className="mm-stack">
          <p>
            {active.total === 0
              ? t("kakaoMap.reading")
              : t("kakaoMap.running", { current: active.current, total: active.total })}
          </p>
          <progress
            className="mm-progress"
            max={Math.max(active.total, 1)}
            value={active.total === 0 ? undefined : active.current}
            aria-label={t("kakaoMap.title")}
          />
        </div>
      )}
      <div aria-live="polite" className="mm-stack" ref={region} tabIndex={-1}>
        {running && <span className="mm-visually-hidden">{t("kakaoMap.started")}</span>}
        {interrupted && <p className="mm-note">{t("kakaoMap.interrupted")}</p>}
        {outcome.kind === "done" && (
          <div>
            <p className="mm-strong">{t("kakaoMap.done")}</p>
            <p>{summaryText(t, outcome.summary)}</p>
          </div>
        )}
      </div>
      {outcome.kind === "failed" && (
        <div className="mm-stack">
          <p className="mm-note" role="alert">
            {t(errorKey(outcome.code))}
          </p>
          {outcome.code === "kakao_signed_out" && (
            <OutLink href={KAKAO_MAP} className="mm-button mm-button--secondary">
              {t("kakaoMap.openKakaoMap")}
            </OutLink>
          )}
        </div>
      )}
      {(ready || running) && (
        <button
          type="button"
          className="mm-button mm-button--primary"
          disabled={blocked || running || !ready}
          aria-describedby={reason}
          onClick={() => start()}
        >
          {outcome.kind === "done" ? t("kakaoMap.again") : t("kakaoMap.start")}
        </button>
      )}
      {last && !interrupted && outcome.kind !== "done" && !running && (
        <div>
          {last.status === "completed" && last.finishedAt ? (
            <>
              <p className="mm-strong">
                {t("kakaoMap.last", { date: formatDateTime(last.finishedAt) })}
              </p>
              {last.summary && <p className="mm-muted">{summaryText(t, last.summary)}</p>}
            </>
          ) : last.status !== "running" ? (
            <p className="mm-muted">{t("kakaoMap.lastFailed")}</p>
          ) : null}
        </div>
      )}

      {outcome.kind === "confirm" && (
        <ConfirmDialog
          title={outcome.mismatch ? t("kakaoMap.mismatchTitle") : t("kakaoMap.confirmTitle")}
          onCancel={cancelConfirm}
          stackActions={outcome.mismatch}
          actions={
            outcome.mismatch ? (
              <>
                {cancelAction}
                <OutLink
                  href={KAKAO_MAP}
                  className="mm-button mm-button--secondary"
                  onClick={cancelConfirm}
                >
                  {t("kakaoMap.signInToYours")}
                </OutLink>
                {syncAction(outcome, t("kakaoMap.switch"))}
              </>
            ) : (
              <>
                {cancelAction}
                {syncAction(outcome, t("kakaoMap.confirm"))}
              </>
            )
          }
        >
          {outcome.mismatch ? (
            <>
              <p>
                {outcome.bound
                  ? t("kakaoMap.mismatchBody", {
                      expected: accountText(t, outcome.bound),
                      current: accountText(t, outcome.account),
                    })
                  : t("kakaoMap.mismatchBodyNoBound", {
                      current: accountText(t, outcome.account),
                    })}
              </p>
              <p className="mm-muted">{t("kakaoMap.mismatchKeeps")}</p>
            </>
          ) : (
            <>
              <p>
                {me.displayName
                  ? t("kakaoMap.confirmBody", {
                      account: accountText(t, outcome.account),
                      name: me.displayName,
                    })
                  : t("kakaoMap.confirmBodyNoName", { account: accountText(t, outcome.account) })}
              </p>
              <p className="mm-muted">
                {t("kakaoMap.confirmNote")} {t("kakaoMap.confirmCancelNote")}
              </p>
            </>
          )}
          {outcome.error && (
            <p className="mm-note" role="alert">
              {t(errorKey(outcome.error))}
            </p>
          )}
          {blocked && (
            <p className="mm-note" id={dialogReasonId}>
              {t("kakaoMap.offline")}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
