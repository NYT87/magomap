// "Sync from Kakao Map" in Account: the magomap extension reads her Kakao Map lists in this
// browser and the sync uploads them. Above the kakao-list import, with the same progress,
// summary, error and last-run parts.
import type { ImportRunInfo, ImportSummary, KakaoMapAccountHint, Me } from "@magomap/domain";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatDate } from "../i18n";
import { summaryText } from "../import/ImportSection";
import {
  currentImportJob,
  currentKakaoMapJob,
  type KakaoMapJob,
  startKakaoMapJob,
  subscribeImportJob,
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

type Outcome =
  | { kind: "none" }
  | { kind: "done"; summary: ImportSummary }
  | { kind: "confirm"; mismatch: boolean; account: KakaoMapAccountHint }
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

/** The confirmation, naming both accounts when it can. */
function confirmText(t: TFunction, account: KakaoMapAccountHint, name: string | null) {
  const values = { idTail: account.idTail, nickname: account.nickname, name };
  if (account.nickname && name) return t("kakaoMap.confirmBody", values);
  if (name) return t("kakaoMap.confirmBodyNoNickname", values);
  if (account.nickname) return t("kakaoMap.confirmBodyNoName", values);
  return t("kakaoMap.confirmBodyNoNames", values);
}

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
  children: string;
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
  const online = useOnline();
  const layout = useLayout();
  const [extension, setExtension] = useState<ExtensionState | "checking">("checking");
  // The sync itself lives outside this screen, so leaving Account and coming back finds it running.
  const job = useSyncExternalStore(subscribeKakaoMapJob, currentKakaoMapJob);
  // A kakao-list import running meanwhile: starting a sync would stop it.
  const importing = useSyncExternalStore(subscribeImportJob, currentImportJob) !== null;
  const [followed, setFollowed] = useState<KakaoMapJob | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [last, setLast] = useState<ImportRunInfo | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const following = useRef<KakaoMapJob | null>(null);
  const reads = useRef(0);

  // The latest read wins, as in the import section.
  const readLast = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const run = asRun(await apiFetch<unknown>("/api/import/runs/latest"));
      if (reads.current === mine) setLast(run?.source === "kakao_map" ? run : null);
    } catch {
      // The last sync just stays as it was.
    }
  }, []);

  /** Shows a sync's end here, whether this screen started it or came back to it. */
  const follow = useCallback(
    async (running: KakaoMapJob) => {
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
        next =
          e?.account &&
          (e.code === "kakao_account_unconfirmed" || e.code === "kakao_account_mismatch")
            ? { kind: "confirm", mismatch: e.code === "kakao_account_mismatch", account: e.account }
            : { kind: "failed", code: e?.code };
      }
      if (!mounted.current) return;
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

  const start = (confirmAccount?: string) => {
    const started = startKakaoMapJob(confirmAccount);
    // The pressed button is about to be disabled: move focus to the results region.
    if (section.current?.contains(document.activeElement) || confirmAccount) {
      region.current?.focus({ preventScroll: true });
    }
    void follow(started);
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
  return (
    <section className="mm-card mm-stack" aria-labelledby={headingId} ref={section}>
      <h2 className="mm-h4" id={headingId}>
        {t("kakaoMap.title")}
      </h2>
      <p className="mm-muted">{t("kakaoMap.lead")}</p>
      {!online && <p className="mm-note">{t("kakaoMap.offline")}</p>}
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
      <div aria-live="polite" className="mm-stack" ref={region} tabIndex={-1}>
        {interrupted && <p className="mm-note">{t("kakaoMap.interrupted")}</p>}
        {running && (
          <>
            <p>
              {active.total === 0
                ? t("kakaoMap.reading")
                : t("import.running", { current: active.current, total: active.total })}
            </p>
            <progress
              className="mm-progress"
              max={Math.max(active.total, 1)}
              value={active.total === 0 ? undefined : active.current}
              aria-label={t("kakaoMap.title")}
            />
          </>
        )}
        {outcome.kind === "done" && (
          <div>
            <p className="mm-strong">{t("kakaoMap.done")}</p>
            <p>{summaryText(t, outcome.summary)}</p>
          </div>
        )}
        {outcome.kind === "failed" && (
          <div className="mm-stack">
            <p className="mm-error" role="alert">
              {t(errorKey(outcome.code))}
            </p>
            {outcome.code === "kakao_signed_out" && (
              <OutLink href={KAKAO_MAP} className="mm-button mm-button--secondary">
                {t("kakaoMap.openKakaoMap")}
              </OutLink>
            )}
          </div>
        )}
      </div>
      {(ready || running) && (
        <button
          type="button"
          className="mm-button mm-button--primary"
          disabled={!online || running || importing || !ready}
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
                {t("kakaoMap.last", { date: formatDate(last.finishedAt) })}
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
          actions={
            outcome.mismatch ? (
              <>
                <button
                  type="button"
                  className="mm-button mm-button--secondary"
                  onClick={cancelConfirm}
                >
                  {t("account.cancel")}
                </button>
                <OutLink
                  href={KAKAO_MAP}
                  className="mm-button mm-button--secondary"
                  onClick={cancelConfirm}
                >
                  {t("kakaoMap.signInToYours")}
                </OutLink>
                <button
                  type="button"
                  className="mm-button mm-button--primary"
                  onClick={() => start(outcome.account.idTail)}
                >
                  {t("kakaoMap.switch")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="mm-button mm-button--secondary"
                  onClick={cancelConfirm}
                >
                  {t("account.cancel")}
                </button>
                <button
                  type="button"
                  className="mm-button mm-button--primary"
                  onClick={() => start(outcome.account.idTail)}
                >
                  {t("kakaoMap.confirm")}
                </button>
              </>
            )
          }
        >
          {outcome.mismatch ? (
            <p>{t("kakaoMap.mismatchBody", { idTail: outcome.account.idTail })}</p>
          ) : (
            <>
              <p>{confirmText(t, outcome.account, me.displayName || null)}</p>
              <p className="mm-muted">{t("kakaoMap.confirmNote")}</p>
            </>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
