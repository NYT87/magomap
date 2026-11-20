import type { ImportStatus, ImportSummary } from "@magomap/domain";
import type { TFunction } from "i18next";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { formatDate } from "../i18n";
import { ImportError, runImport } from "./runImport";
import { useOnline } from "./useOnline";
import { holdScreenOn } from "./wakeLock";

type State =
  | { kind: "idle" }
  | { kind: "running"; current: number; total: number }
  | { kind: "done"; summary: ImportSummary }
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
  const [state, setState] = useState<State>({ kind: "idle" });
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const [freshStart, setFreshStart] = useState(false);

  const readStatus = () => apiFetch<ImportStatus>("/api/import/status").then(setStatus, () => {});

  useEffect(() => {
    if (!online) return;
    apiFetch<ImportStatus>("/api/import/status").then(setStatus, () => {});
  }, [online]);

  const start = async (resumeRunId?: string) => {
    setFreshStart(false);
    setState({ kind: "running", current: 0, total: 0 });
    // The pressed button is about to be disabled: move focus to the results region.
    if (section.current?.contains(document.activeElement)) {
      region.current?.focus({ preventScroll: true });
    }
    const release = holdScreenOn();
    try {
      const summary = await runImport(
        ({ listIndex, listCount }) =>
          setState({ kind: "running", current: listIndex + 1, total: listCount }),
        { ...(resumeRunId ? { resumeRunId } : {}), onFreshStart: () => setFreshStart(true) },
      );
      setState({ kind: "done", summary });
    } catch (error) {
      const e = error instanceof ImportError ? error : null;
      // A refused start means kakao-list has nothing new: the up-to-date note says so.
      setState(e?.code === "up_to_date" ? { kind: "idle" } : { kind: "failed", error: e });
    } finally {
      release();
      await readStatus();
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
    }
  };

  const last = status?.latest ?? null;
  const stopped = last?.status === "running" ? last : null;
  const syncedAt = status?.sourceSnapshotAt ?? null;
  const newer = stopped !== null && syncedAt !== null && syncedAt !== stopped.snapshotAt;
  const upToDate = status?.upToDate === true && syncedAt !== null;
  const resumable = stopped !== null && !newer && !upToDate && state.kind !== "done";
  const running = state.kind === "running";
  return (
    <section className="mm-card mm-stack" aria-labelledby={headingId} ref={section}>
      <h2 className="mm-h4" id={headingId}>
        {t("import.title")}
      </h2>
      <p className="mm-muted">{t("import.lead")}</p>
      {!online && <p className="mm-note">{t("import.offline")}</p>}
      <div aria-live="polite" className="mm-stack" ref={region} tabIndex={-1}>
        {state.kind === "idle" && upToDate && syncedAt !== null && (
          <p className="mm-note">{t("import.upToDate", { date: formatDate(syncedAt) })}</p>
        )}
        {state.kind === "idle" && !upToDate && stopped && (
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
              {state.total === 0
                ? t("import.starting")
                : t("import.running", { current: state.current, total: state.total })}
            </p>
            <progress
              className="mm-progress"
              max={Math.max(state.total, 1)}
              value={state.total === 0 ? undefined : state.current}
              aria-label={t("import.title")}
            />
          </>
        )}
        {freshStart && <p className="mm-note">{t("import.freshStart")}</p>}
        {state.kind === "done" && (
          <div>
            <p className="mm-strong">{t("import.done")}</p>
            <p>{summaryText(t, state.summary)}</p>
          </div>
        )}
        {state.kind === "failed" && (
          <p className="mm-error" role="alert">
            {t(errorKey(state.error))}
          </p>
        )}
      </div>
      <button
        key="primary"
        type="button"
        className="mm-button mm-button--primary"
        disabled={!online || running || upToDate}
        onClick={() => void start(resumable ? stopped.runId : undefined)}
      >
        {resumable
          ? t("import.continue")
          : state.kind === "done"
            ? t("import.again")
            : t("import.start")}
      </button>
      {resumable && (
        <button
          type="button"
          className="mm-button mm-button--secondary"
          disabled={!online || running}
          onClick={() => void start()}
        >
          {t("import.startOver")}
        </button>
      )}
      {last && !stopped && state.kind !== "done" && (
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
