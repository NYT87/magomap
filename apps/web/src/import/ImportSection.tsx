import type { ImportStatus, ImportSummary } from "@magomap/domain";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { formatDate } from "../i18n";
import { currentImportJob, type ImportJob, startImportJob, subscribeImportJob } from "./importJob";
import { ImportError } from "./runImport";
import { useOnline } from "./useOnline";

type Outcome =
  | { kind: "none" }
  | { kind: "done"; summary: ImportSummary; freshStart: boolean }
  | { kind: "failed"; error: ImportError | null };

function summaryText(t: TFunction, s: ImportSummary) {
  const parts = [
    s.placesAdded && t("import.summaryAdded", { count: s.placesAdded }),
    s.membershipsRemoved && t("import.summaryRemoved", { count: s.membershipsRemoved }),
    s.membershipsRestored && t("import.summaryRestored", { count: s.membershipsRestored }),
    s.placesMoved && t("import.summaryMoved", { count: s.placesMoved }),
    s.notesImported && t("import.summaryNotes", { count: s.notesImported }),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("import.nothingChanged");
}

function errorKey(e: ImportError | null): string {
  switch (e?.code) {
    case "no_snapshot":
      return "import.errNoSnapshot";
    case "kakao_list_unavailable":
      return "import.errUnavailable";
    case "snapshot_changed":
    case "run_closed":
      return "import.errChanged";
    case "offline":
      return "import.errOffline";
    case "signed_out":
      return "import.errSignedOut";
    default:
      return "import.errOther";
  }
}

/** Import from kakao-list: a section of the Account screen. */
export function ImportSection() {
  const { t } = useTranslation();
  const headingId = useId();
  const online = useOnline();
  const noteId = useId();
  // The import itself lives outside this screen, so leaving Account and coming back finds it running.
  const job = useSyncExternalStore(subscribeImportJob, currentImportJob);
  const [followed, setFollowed] = useState<ImportJob | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const following = useRef<ImportJob | null>(null);
  const reads = useRef(0);

  // The latest read wins: one that started before a newer one (or before an import began)
  // can't change what is on screen when it lands.
  const readStatus = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const next = await apiFetch<ImportStatus>("/api/import/status");
      if (reads.current === mine) setStatus(next);
    } catch {
      // The notes just stay as they were.
    }
  }, []);

  /** Shows an import's end here, whether this screen started it or came back to it. */
  const follow = useCallback(
    async (running: ImportJob) => {
      if (following.current === running) return;
      following.current = running;
      reads.current += 1;
      setFollowed(running);
      setOutcome({ kind: "none" });
      let next: Outcome;
      try {
        const { summary, freshStart } = await running.promise;
        next = { kind: "done", summary, freshStart };
      } catch (error) {
        const e = error instanceof ImportError ? error : null;
        // A refused start means kakao-list has nothing new: the up-to-date note says so.
        next = e?.code === "up_to_date" ? { kind: "none" } : { kind: "failed", error: e };
      }
      if (!mounted.current) return;
      following.current = null;
      setOutcome(next);
      setFollowed(null);
      await readStatus();
      if (!mounted.current) return;
      // Keep focus from dropping to the page when the buttons change, but never pull it back
      // from a control she moved to during the import.
      const active = document.activeElement;
      const lost =
        !active ||
        active === document.body ||
        (section.current?.contains(active) &&
          active instanceof HTMLButtonElement &&
          active.disabled);
      if (lost) region.current?.focus({ preventScroll: true });
    },
    [readStatus],
  );

  useEffect(() => {
    mounted.current = true;
    const running = currentImportJob();
    if (running) void follow(running);
    return () => {
      mounted.current = false;
      following.current = null;
    };
  }, [follow]);

  useEffect(() => {
    if (online) void readStatus();
  }, [online, readStatus]);

  const start = (resumeRunId?: string) => {
    const started = startImportJob(resumeRunId);
    // The pressed button is about to be disabled: move focus to the results region.
    if (section.current?.contains(document.activeElement)) {
      region.current?.focus({ preventScroll: true });
    }
    void follow(started);
  };

  const last = status?.latest ?? null;
  const stopped = last?.status === "running" ? last : null;
  const syncedAt = status?.sourceSnapshotAt ?? null;
  const newer = stopped !== null && syncedAt !== null && syncedAt !== stopped.snapshotAt;
  const upToDate = status?.upToDate === true && syncedAt !== null;
  const active = job ?? followed;
  const running = active !== null;
  const idle = !running && outcome.kind === "none";
  // kakao-list has no sync for this account: say so now, and there is nothing to continue.
  const noSnapshot = status?.source === "no_snapshot";
  const resumable =
    stopped !== null && !running && !newer && !upToDate && !noSnapshot && outcome.kind !== "done";
  const showUpToDate = upToDate && syncedAt !== null && (idle || outcome.kind === "done");
  const freshStart = running ? active.freshStart : outcome.kind === "done" && outcome.freshStart;
  return (
    <section className="mm-card mm-stack" aria-labelledby={headingId} ref={section}>
      <h2 className="mm-h4" id={headingId}>
        {t("import.title")}
      </h2>
      <p className="mm-muted">{t("import.lead")}</p>
      {!online && <p className="mm-note">{t("import.offline")}</p>}
      <div aria-live="polite" className="mm-stack" ref={region} tabIndex={-1}>
        {idle && noSnapshot && <p className="mm-note">{t("import.errNoSnapshot")}</p>}
        {idle && !noSnapshot && !upToDate && stopped && (
          <p className="mm-note">
            {newer && syncedAt !== null
              ? t("import.stoppedNewer", { date: formatDate(syncedAt) })
              : stopped.progress
                ? t("import.stopped", {
                    done: stopped.progress.listsDone,
                    total: stopped.progress.listCount,
                  })
                : t("import.stoppedNoCount")}
          </p>
        )}
        {running && (
          <>
            <p>
              {active.total === 0
                ? t("import.starting")
                : t("import.running", { current: active.current, total: active.total })}
            </p>
            <progress
              className="mm-progress"
              max={Math.max(active.total, 1)}
              value={active.total === 0 ? undefined : active.current}
              aria-label={t("import.title")}
            />
          </>
        )}
        {freshStart && <p className="mm-note">{t("import.freshStart")}</p>}
        {outcome.kind === "done" && (
          <div>
            <p className="mm-strong">{t("import.done")}</p>
            <p>{summaryText(t, outcome.summary)}</p>
          </div>
        )}
        {showUpToDate && syncedAt !== null && (
          <p className="mm-note" id={noteId}>
            {t("import.upToDate", { date: formatDate(syncedAt) })}
          </p>
        )}
        {outcome.kind === "failed" && (
          <p className="mm-error" role="alert">
            {t(errorKey(outcome.error))}
          </p>
        )}
      </div>
      <button
        key="primary"
        type="button"
        className="mm-button mm-button--primary"
        disabled={!online || running || upToDate || noSnapshot}
        aria-describedby={showUpToDate && !running ? noteId : undefined}
        onClick={() => start(resumable ? stopped.runId : undefined)}
      >
        {resumable
          ? t("import.continue")
          : outcome.kind === "done"
            ? t("import.again")
            : t("import.start")}
      </button>
      {resumable && (
        <button
          type="button"
          className="mm-button mm-button--secondary"
          disabled={!online || running}
          onClick={() => start()}
        >
          {t("import.startOver")}
        </button>
      )}
      {last && !stopped && outcome.kind !== "done" && (
        <div>
          {last.status === "completed" && last.finishedAt ? (
            <>
              <p className="mm-strong">{t("import.last", { date: formatDate(last.finishedAt) })}</p>
              {last.summary && <p className="mm-muted">{summaryText(t, last.summary)}</p>}
            </>
          ) : (
            <p className="mm-muted">{t("import.lastFailed")}</p>
          )}
        </div>
      )}
    </section>
  );
}
