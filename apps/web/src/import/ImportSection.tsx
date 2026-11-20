import type { ImportRunInfo, ImportSummary } from "@magomap/domain";
import type { TFunction } from "i18next";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { formatDate } from "../i18n";
import { ImportError, runImport } from "./runImport";
import { useOnline } from "./useOnline";

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
  const [last, setLast] = useState<ImportRunInfo | null>(null);

  useEffect(() => {
    if (!online) return;
    apiFetch<ImportRunInfo | null>("/api/import/runs/latest").then(setLast, () => {});
  }, [online]);

  const start = async () => {
    setState({ kind: "running", current: 0, total: 0 });
    try {
      const summary = await runImport(({ listIndex, listCount }) =>
        setState({ kind: "running", current: listIndex + 1, total: listCount }),
      );
      setState({ kind: "done", summary });
      apiFetch<ImportRunInfo | null>("/api/import/runs/latest").then(setLast, () => {});
    } catch (error) {
      setState({ kind: "failed", error: error instanceof ImportError ? error : null });
    }
  };

  const running = state.kind === "running";
  return (
    <section className="mm-card mm-stack" aria-labelledby={headingId}>
      <h2 className="mm-h4" id={headingId}>
        {t("import.title")}
      </h2>
      <p className="mm-muted">{t("import.lead")}</p>
      {!online && <p className="mm-note">{t("import.offline")}</p>}
      <button
        type="button"
        className="mm-button mm-button--primary"
        disabled={!online || running}
        onClick={() => void start()}
      >
        {state.kind === "done" ? t("import.again") : t("import.start")}
      </button>
      <div aria-live="polite" className="mm-stack">
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
      {last && state.kind !== "done" && (
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
