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
const { forgetImportJob } = await import("./importJob");
const { openUserDb } = await import("../data/db");
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
  openUserDb("A");
  forgetImportJob();
  runImport.mockReset();
  holdScreenOn.mockClear();
  release.mockClear();
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("ImportSection", () => {
  it("turns importing off when the last import used kakao-list's latest sync", async () => {
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true, source: "ok" });
    render(<ImportSection />);
    expect(await screen.findByText(new RegExp(`sync of ${formatDate(SNAP)}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import from kakao-list" })).toBeDisabled();
  });

  it("offers Continue and Start over for a run stopped on the same sync", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    runImport.mockResolvedValue({});
    render(<ImportSection />);
    expect(
      await screen.findByText("The last import stopped at 12 of 30 lists. Nothing was removed."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Continue import" }));
    expect(runImport).toHaveBeenCalledWith(expect.any(Function), {
      resumeRunId: "r1",
      account: "A",
      onRun: expect.any(Function),
      onFreshStart: expect.any(Function),
    });
  });

  it("offers only a fresh import when kakao-list synced after the run stopped", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP + 86_400_000, upToDate: false, source: "ok" });
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
    status({ latest: run(), sourceSnapshotAt: null, upToDate: false, source: "ok" });
    render(<ImportSection />);
    expect(await screen.findByRole("button", { name: "Continue import" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start over" })).toBeEnabled();
  });

  it("explains a fresh start after Continue", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
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
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    runImport.mockRejectedValue(new Error("boom"));
    render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Start over" }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(holdScreenOn).toHaveBeenCalledTimes(1);
    expect(api.mock.calls.filter((c) => c[0] === "/api/import/status")).toHaveLength(2);
  });

  it("shows the up-to-date note when a start is refused as already imported", async () => {
    status({ latest: null, sourceSnapshotAt: null, upToDate: false, source: "ok" });
    runImport.mockRejectedValue(new ImportError("start", "up_to_date"));
    render(<ImportSection />);
    const button = await screen.findByRole("button", { name: "Import from kakao-list" });
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true, source: "ok" });
    await userEvent.click(button);
    expect(await screen.findByText(/Up to date with your kakao-list sync/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("doesn't invent a count when the run has no progress", async () => {
    status({
      latest: run({ progress: undefined }),
      sourceSnapshotAt: SNAP,
      upToDate: false,
      source: "ok",
    });
    render(<ImportSection />);
    expect(
      await screen.findByText("The last import stopped. Nothing was removed."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it("keeps keyboard focus inside the section after an import ends", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
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
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    const first = render(<ImportSection />);
    const note = await screen.findByText(/The last import stopped at 12 of 30/);
    expect(note.closest("[aria-live='polite']")).not.toBeNull();
    first.unmount();
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true, source: "ok" });
    render(<ImportSection />);
    const upToDate = await screen.findByText(/Up to date with your kakao-list sync/);
    expect(upToDate.closest("[aria-live='polite']")).not.toBeNull();
  });

  it("moves focus off the pressed button while importing", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
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
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
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

  it("still shows a running import after leaving Account and coming back", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    let finish: (v: unknown) => void = () => {};
    runImport.mockImplementation(
      (
        onProgress: (p: { listIndex: number; listCount: number }) => void,
        opts: { onRun: (id: string) => void },
      ) => {
        opts.onRun("r1");
        onProgress({ listIndex: 12, listCount: 30 });
        return new Promise((resolve) => (finish = resolve));
      },
    );
    const first = render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    await screen.findByText(/Importing/);
    first.unmount();

    render(<ImportSection />);
    expect(await screen.findByText(/Importing list 13 of 30/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    expect(screen.queryByText(/stopped/)).toBeNull();
    expect(holdScreenOn).toHaveBeenCalledTimes(1);

    finish({ placesAdded: 2 });
    expect(await screen.findByText("Import finished")).toBeInTheDocument();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("doesn't show another account's import after signing in as someone else", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    let finish: (v: unknown) => void = () => {};
    runImport.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    await screen.findByText(/Getting your lists|Importing/);
    first.unmount();

    openUserDb("B");
    render(<ImportSection />);
    expect(await screen.findByRole("button", { name: "Continue import" })).toBeEnabled();
    expect(screen.queryByText(/Importing|Getting your lists/)).toBeNull();

    finish({ placesAdded: 5 });
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Import finished")).toBeNull();
  });

  it("says up front when kakao-list has nothing for this account", async () => {
    status({ latest: run(), sourceSnapshotAt: null, upToDate: false, source: "no_snapshot" });
    const { container } = render(<ImportSection />);
    const note = await screen.findByText(/kakao-list has nothing for your Kakao account yet/);
    expect(note.closest("[aria-live='polite']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Import from kakao-list" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Continue import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    expect(container.textContent).not.toMatch(/stopped at/);
  });

  it("doesn't call a refused start a newer sync", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    runImport.mockImplementation(async (_p: unknown, opts: { onFreshStart?: () => void }) => {
      // The stopped run was closed, so continuing began again; kakao-list had nothing new.
      opts.onFreshStart?.();
      throw new ImportError("start", "up_to_date");
    });
    render(<ImportSection />);
    const button = await screen.findByRole("button", { name: "Continue import" });
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: true, source: "ok" });
    await userEvent.click(button);
    expect(await screen.findByText(/Up to date with your kakao-list sync/)).toBeInTheDocument();
    expect(screen.queryByText(/newer sync, so the import started again/)).toBeNull();
  });

  it("drops the fresh-start note when the import then fails", async () => {
    status({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    runImport.mockImplementation(async (_p: unknown, opts: { onFreshStart?: () => void }) => {
      opts.onFreshStart?.();
      throw new ImportError("list", "offline", 0);
    });
    render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/newer sync, so the import started again/)).toBeNull();
  });

  it("explains the disabled button after a finished import", async () => {
    status({ latest: null, sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    runImport.mockResolvedValue({ placesAdded: 3 });
    render(<ImportSection />);
    const button = await screen.findByRole("button", { name: "Import from kakao-list" });
    status({
      latest: run({ status: "completed" }),
      sourceSnapshotAt: SNAP,
      upToDate: true,
      source: "ok",
    });
    await userEvent.click(button);
    await screen.findByText("Import finished");
    expect(await screen.findByText(/Up to date with your kakao-list sync/)).toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Import again" });
    expect(again).toBeDisabled();
    expect(again).toHaveAccessibleDescription(/Up to date with your kakao-list sync/);
  });

  it("lets the latest status read win over one that was slow to arrive", async () => {
    let slow: (s: ImportStatus) => void = () => {};
    let reads = 0;
    api.mockImplementation(async (path: string) => {
      if (path !== "/api/import/status") return {};
      reads += 1;
      if (reads === 1) return new Promise((resolve) => (slow = resolve));
      return { latest: null, sourceSnapshotAt: SNAP, upToDate: true, source: "ok" };
    });
    runImport.mockResolvedValue({});
    render(<ImportSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Import from kakao-list" }));
    await screen.findByText("Import finished");
    await screen.findByText(/Up to date with your kakao-list sync/);
    slow({ latest: run(), sourceSnapshotAt: SNAP, upToDate: false, source: "ok" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText(/Up to date with your kakao-list sync/)).toBeInTheDocument();
    expect(screen.queryByText(/stopped at/)).toBeNull();
  });
});
