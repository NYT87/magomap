import type { ImportRunInfo, ImportStatus } from "@magomap/domain";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n, { formatDate } from "../i18n";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const runImport = vi.fn();
vi.mock("./runImport", async (orig) => {
  const actual = await orig<typeof import("./runImport")>();
  return { ...actual, runImport: (...args: unknown[]) => runImport(...args) };
});
const release = vi.fn();
const holdScreenOn = vi.fn(() => release);
vi.mock("./wakeLock", () => ({ holdScreenOn: () => holdScreenOn() }));
const { ImportSection } = await import("./ImportSection");
const { ImportError } = await import("./runImport");

const SNAP = Date.UTC(2026, 10, 18);
const run = (over: Partial<ImportRunInfo> = {}): ImportRunInfo => ({
  runId: "r1",
  status: "running",
  startedAt: SNAP,
  finishedAt: null,
  summary: null,
  snapshotAt: SNAP,
  progress: { listsDone: 12, listCount: 30 },
  ...over,
});

function status(s: ImportStatus) {
  api.mockImplementation(async (path: string) => (path === "/api/import/status" ? s : {}));
}

beforeEach(async () => {
  api.mockReset();
  runImport.mockReset();
  holdScreenOn.mockClear();
  release.mockClear();
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("ImportSection", () => {
  it("turns importing off when the last import used kakao-list's latest sync", async () => {
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true });
    render(<ImportSection />);
    expect(await screen.findByText(new RegExp(`sync of ${formatDate(SNAP)}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import from kakao-list" })).toBeDisabled();
  });

  it("offers Continue and Start over for a run stopped on the same sync", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    runImport.mockResolvedValue({});
    render(<ImportSection />);
    expect(
      await screen.findByText("The last import stopped at 12 of 30 lists. Nothing was removed."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Continue import" }));
    expect(runImport).toHaveBeenCalledWith(expect.any(Function), {
      resumeRunId: "r1",
      onFreshStart: expect.any(Function),
    });
  });

  it("offers only a fresh import when kakao-list synced after the run stopped", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP + 86_400_000, upToDate: false });
    runImport.mockResolvedValue({});
    render(<ImportSection />);
    expect(
      await screen.findByText(/stopped, and kakao-list has a newer sync from/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue import" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Import from kakao-list" }));
    expect(runImport.mock.calls[0]?.[1]).not.toHaveProperty("resumeRunId");
  });

  it("offers both when kakao-list can't be reached", async () => {
    status({ latest: run(), sourceSnapshotAt: null, upToDate: false });
    render(<ImportSection />);
    expect(await screen.findByRole("button", { name: "Continue import" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start over" })).toBeEnabled();
  });

  it("explains a fresh start after Continue", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    runImport.mockImplementation(async (_p: unknown, opts: { onFreshStart?: () => void }) => {
      opts.onFreshStart?.();
      return {};
    });
    render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    expect(
      await screen.findByText(
        "kakao-list has a newer sync, so the import started again from the beginning.",
      ),
    ).toBeInTheDocument();
  });

  it("holds the screen on for the whole import and re-reads the status after it", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    runImport.mockRejectedValue(new Error("boom"));
    render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Start over" }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(holdScreenOn).toHaveBeenCalledTimes(1);
    expect(api.mock.calls.filter((c) => c[0] === "/api/import/status")).toHaveLength(2);
  });

  it("shows the up-to-date note when a start is refused as already imported", async () => {
    status({ latest: null, sourceSnapshotAt: null, upToDate: false });
    runImport.mockRejectedValue(new ImportError("start", "up_to_date"));
    render(<ImportSection />);
    const button = await screen.findByRole("button", { name: "Import from kakao-list" });
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true });
    await userEvent.click(button);
    expect(await screen.findByText(/Up to date with your kakao-list sync/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("doesn't invent a count when the run has no progress", async () => {
    status({ latest: run({ progress: undefined }), sourceSnapshotAt: SNAP, upToDate: false });
    render(<ImportSection />);
    expect(
      await screen.findByText("The last import stopped. Nothing was removed."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it("keeps keyboard focus inside the section after an import ends", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    runImport.mockResolvedValue({});
    const { container } = render(<ImportSection />);
    const button = await screen.findByRole("button", { name: "Continue import" });
    button.focus();
    await userEvent.click(button);
    await screen.findByText("Import finished");
    await waitFor(() => expect(container.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("announces the stopped and up-to-date notes in the polite live region", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    const first = render(<ImportSection />);
    const note = await screen.findByText(/The last import stopped at 12 of 30/);
    expect(note.closest("[aria-live='polite']")).not.toBeNull();
    first.unmount();
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true });
    render(<ImportSection />);
    const upToDate = await screen.findByText(/Up to date with your kakao-list sync/);
    expect(upToDate.closest("[aria-live='polite']")).not.toBeNull();
  });

  it("moves focus off the pressed button while importing", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    runImport.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ImportSection />);
    const button = await screen.findByRole("button", { name: "Continue import" });
    button.focus();
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    const active = document.activeElement;
    expect(active).not.toBe(button);
    expect(active).not.toBe(document.body);
    expect(container.contains(active)).toBe(true);
  });

  it("leaves focus alone if she moved on during the import", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false });
    let finish: (v: unknown) => void = () => {};
    runImport.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(
      <>
        <ImportSection />
        <input aria-label="elsewhere" />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    const other = screen.getByLabelText("elsewhere");
    other.focus();
    finish({});
    await screen.findByText("Import finished");
    await waitFor(() =>
      expect(api.mock.calls.filter((c) => c[0] === "/api/import/status")).toHaveLength(2),
    );
    expect(document.activeElement).toBe(other);
  });
});
