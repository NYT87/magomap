import type { ImportRunInfo, Me } from "@magomap/domain";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n, { formatDate } from "../i18n";
import { setViewportWidth } from "../test/setup";

const api = vi.fn();
vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => api(...args) };
});
const detectExtension = vi.fn();
const runKakaoMapSync = vi.fn();
const forgetKakaoMapRead = vi.fn();
vi.mock("../import/kakaoMap", async (orig) => {
  const actual = await orig<typeof import("../import/kakaoMap")>();
  return {
    ...actual,
    detectExtension: () => detectExtension(),
    runKakaoMapSync: (...args: unknown[]) => runKakaoMapSync(...args),
    forgetKakaoMapRead: () => forgetKakaoMapRead(),
  };
});
const release = vi.fn();
vi.mock("../import/wakeLock", () => ({ holdScreenOn: () => release }));
const { KakaoMapSyncSection } = await import("./KakaoMapSyncSection");
const { KakaoMapSyncError } = await import("../import/kakaoMap");
const { forgetImportJob } = await import("../import/importJob");
const { openUserDb } = await import("../data/db");

const me: Me = { userId: "A", displayName: "호세", identities: [{ provider: "kakao" }] };
const summary = {
  listsAdded: 2,
  listsUpdated: 0,
  listsRemoved: 0,
  placesAdded: 538,
  placesMoved: 0,
  membershipsRemoved: 3,
  membershipsRestored: 0,
  notesImported: 0,
};
const T = Date.UTC(2026, 10, 20);

function latest(run: Partial<ImportRunInfo> | null) {
  api.mockImplementation(async (path: string) =>
    path === "/api/import/runs/latest"
      ? run && {
          runId: "r0",
          status: "completed",
          startedAt: T,
          finishedAt: T,
          summary: null,
          snapshotAt: T,
          source: "kakao_map",
          ...run,
        }
      : {},
  );
}

const section = () => screen.getByRole("region", { name: "Sync from Kakao Map" });
const syncButton = () => screen.findByRole("button", { name: "Sync from Kakao Map" });

/** Renders with the extension there, then presses Sync. */
async function startSync() {
  detectExtension.mockResolvedValue("ready");
  render(<KakaoMapSyncSection me={me} />);
  await userEvent.click(await syncButton());
}

beforeEach(async () => {
  api.mockReset();
  latest(null);
  detectExtension.mockReset();
  runKakaoMapSync.mockReset();
  forgetKakaoMapRead.mockReset();
  openUserDb("A");
  forgetImportJob();
  setViewportWidth(1440);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("KakaoMapSyncSection", () => {
  it("missing on desktop shows the install link", async () => {
    detectExtension.mockResolvedValue("missing");
    render(<KakaoMapSyncSection me={me} />);
    const link = await screen.findByRole("link", { name: /Get the magomap extension/ });
    expect(link.getAttribute("href")).toMatch(/github\.com\/.+\/releases.*extension-v/);
    expect(screen.queryByRole("button", { name: "Sync from Kakao Map" })).toBeNull();
  });

  it("missing on phone says it works on a computer for now", async () => {
    setViewportWidth(390);
    detectExtension.mockResolvedValue("missing");
    render(<KakaoMapSyncSection me={me} />);
    expect(await screen.findByText(/works on a computer for now/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Get the magomap extension/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync from Kakao Map" })).toBeNull();
  });

  it("confirm dialog names both accounts", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    await startSync();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Sync 수지's Kakao Map (••••1234) into 호세's magomap?");
    // Cancel writes nothing: no second run, and the kept read is dropped.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(runKakaoMapSync).toHaveBeenCalledTimes(1);
    expect(forgetKakaoMapRead).toHaveBeenCalledTimes(1);

    // Sync retries, confirming the account she was shown.
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    await userEvent.click(await syncButton());
    runKakaoMapSync.mockResolvedValueOnce(summary);
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sync" }),
    );
    expect(runKakaoMapSync).toHaveBeenLastCalledWith(expect.any(Function), {
      account: "A",
      confirmAccount: "1234",
    });
    expect(await within(section()).findByText("Sync finished")).toBeInTheDocument();
  });

  it("says 'your magomap' when she has no name yet, in Korean too", async () => {
    await i18n.changeLanguage("ko");
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    detectExtension.mockResolvedValue("ready");
    render(<KakaoMapSyncSection me={{ ...me, displayName: null }} />);
    await userEvent.click(await screen.findByRole("button", { name: "카카오맵에서 동기화" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "수지님의 카카오맵(••••1234)을 내 magomap에 동기화할까요?",
    );
  });

  it("a different Kakao Map account says so", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_mismatch", { nickname: "수지", idTail: "1234" }),
    );
    await startSync();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "This browser is signed in to a different Kakao Map account (••••1234). Sign in to yours, or confirm to switch.",
    );
    const signIn = within(dialog).getByRole("link", { name: /Sign in to yours/ });
    expect(signIn).toHaveAttribute("href", "https://map.kakao.com");
    runKakaoMapSync.mockResolvedValueOnce(summary);
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm to switch" }));
    expect(runKakaoMapSync).toHaveBeenLastCalledWith(expect.any(Function), {
      account: "A",
      confirmAccount: "1234",
    });
  });

  it("signed out of Kakao Map shows the sign-in hint with a link to map.kakao.com", async () => {
    runKakaoMapSync.mockRejectedValueOnce(new KakaoMapSyncError("kakao_signed_out"));
    await startSync();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign in to Kakao Map in this browser",
    );
    expect(within(section()).getByRole("link", { name: /Open Kakao Map/ })).toHaveAttribute(
      "href",
      "https://map.kakao.com",
    );
  });

  it("taken / not_allowed / unclear show their messages", async () => {
    const cases = [
      ["kakao_account_taken", /already syncs into someone else's magomap/],
      ["not_allowed", /isn't turned on for your account/],
      ["kakao_account_unclear", /Couldn't tell which Kakao Map account/],
    ] as const;
    detectExtension.mockResolvedValue("ready");
    render(<KakaoMapSyncSection me={me} />);
    for (const [code, message] of cases) {
      runKakaoMapSync.mockRejectedValueOnce(new KakaoMapSyncError(code));
      await userEvent.click(await syncButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    }
  });

  it("progress and summary use the import strings", async () => {
    let report: (p: { listIndex: number; listCount: number }) => void = () => {};
    let finish: (s: typeof summary) => void = () => {};
    runKakaoMapSync.mockImplementationOnce(
      (onProgress: typeof report) =>
        new Promise((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    await startSync();
    expect(await within(section()).findByText("Reading your lists from Kakao Map…")).toBeVisible();
    act(() => report({ listIndex: 1, listCount: 3 }));
    expect(await within(section()).findByText("Importing list 2 of 3…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync from Kakao Map" })).toBeDisabled();
    latest({ summary });
    await act(async () => finish(summary));
    expect(await within(section()).findByText("Sync finished")).toBeVisible();
    expect(within(section()).getByText("538 added · 3 removed from Kakao")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync again" })).toBeEnabled();
    expect(release).toHaveBeenCalled();
  });

  it("offline disables the button", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    detectExtension.mockResolvedValue("ready");
    render(<KakaoMapSyncSection me={me} />);
    expect(await syncButton()).toBeDisabled();
    expect(screen.getByText(/Syncing needs a connection/)).toBeInTheDocument();
  });

  it("shows the last sync, and says a reload stopped one", async () => {
    detectExtension.mockResolvedValue("ready");
    latest({ summary });
    render(<KakaoMapSyncSection me={me} />);
    expect(await within(section()).findByText(`Last sync: ${formatDate(T)}`)).toBeInTheDocument();
    cleanup();
    latest({ status: "running", finishedAt: null });
    render(<KakaoMapSyncSection me={me} />);
    expect(await within(section()).findByText(/Start the sync again/)).toBeInTheDocument();
  });

  it("ignores a kakao-list import's run", async () => {
    detectExtension.mockResolvedValue("ready");
    latest({ source: "kakao_list", status: "running" });
    render(<KakaoMapSyncSection me={me} />);
    await syncButton();
    await waitFor(() => expect(api).toHaveBeenCalledWith("/api/import/runs/latest"));
    expect(within(section()).queryByText(/Start the sync again/)).toBeNull();
    expect(within(section()).queryByText(/Last sync/)).toBeNull();
  });
});
