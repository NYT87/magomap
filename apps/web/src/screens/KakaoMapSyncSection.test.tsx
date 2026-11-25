import type { ImportRunInfo, Me } from "@magomap/domain";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n, { formatDateTime } from "../i18n";
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
  openUserDb("A");
  forgetImportJob();
  forgetKakaoMapRead.mockReset();
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
    expect(
      await screen.findByText(/Syncing from Kakao Map happens on a computer/),
    ).toBeInTheDocument();
    // Her lists on the phone stay as she last synced them.
    expect(
      screen.getByText(/The lists on this phone show what you last synced/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Get the magomap extension/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync from Kakao Map" })).toBeNull();
  });

  it("confirm dialog names both accounts", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    await startSync();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Sync 수지's Kakao Map account ending in 1234 into 호세's magomap?",
    );
    // The tail is read out as words, never as bullets.
    expect(dialog.textContent).not.toContain("••••");
    // It says Cancel changes nothing, and how to change the account later.
    expect(dialog).toHaveTextContent("If you cancel, nothing changes.");
    expect(dialog).toHaveTextContent("sync from the other account and switch to it");
    // The dialog's body describes it.
    const described = dialog.getAttribute("aria-describedby");
    expect(described && document.getElementById(described)).toHaveTextContent(/Sync 수지's/);
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
    expect(await within(section()).findByText("Synced with Kakao Map")).toBeInTheDocument();
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
      "수지님의 카카오맵 계정(끝자리 1234)을 내 magomap에 동기화할까요?",
    );
  });

  it("a different Kakao Map account says so", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError(
        "kakao_account_mismatch",
        { nickname: "수지", idTail: "1234" },
        { nickname: "호세", idTail: "7800" },
      ),
    );
    await startSync();
    const dialog = await screen.findByRole("alertdialog");
    // It names the account she syncs from and the one signed in, and what switching keeps.
    expect(dialog).toHaveTextContent(
      "Your magomap syncs from 호세's Kakao Map account ending in 7800, but this browser is signed in to 수지's Kakao Map account ending in 1234. Sign in to yours, or switch to this account.",
    );
    expect(dialog).toHaveTextContent(
      "Your notes and saved places stay. Lists that aren't in this Kakao Map account will show as “Removed from Kakao” after the sync.",
    );
    const signIn = within(dialog).getByRole("link", { name: /Sign in to yours/ });
    expect(signIn).toHaveAttribute("href", "https://map.kakao.com");
    runKakaoMapSync.mockResolvedValueOnce(summary);
    await userEvent.click(within(dialog).getByRole("button", { name: "Switch to this account" }));
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

  it("taken / not_allowed / unclear / too large show their messages, with a next step", async () => {
    const cases = [
      ["kakao_account_taken", /already syncs into someone else's magomap/],
      ["not_allowed", /isn't turned on for your account yet\. Ask the person who set up magomap/],
      [
        "kakao_account_unclear",
        /Couldn't tell which Kakao Map account.*sign in to Kakao Map again/,
      ],
      ["too_large", /too big to sync.*tell the person who set up magomap/],
    ] as const;
    detectExtension.mockResolvedValue("ready");
    render(<KakaoMapSyncSection me={me} />);
    for (const [code, message] of cases) {
      runKakaoMapSync.mockRejectedValueOnce(new KakaoMapSyncError(code));
      await userEvent.click(await syncButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    }
  });

  it("progress and summary have their own sync strings", async () => {
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
    expect(await within(section()).findByText("Syncing list 2 of 3…")).toBeVisible();
    // The progress isn't in the live region; only the start is announced there.
    const live = section().querySelector("[aria-live]");
    expect(live).not.toHaveTextContent("Syncing list");
    expect(live).toHaveTextContent("Sync started.");
    expect(screen.getByRole("button", { name: "Sync from Kakao Map" })).toBeDisabled();
    latest({ summary });
    await act(async () => finish(summary));
    expect(await within(section()).findByText("Synced with Kakao Map")).toBeVisible();
    expect(within(section()).getByText("538 added · 3 removed in Kakao Map")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync again" })).toBeEnabled();
    expect(release).toHaveBeenCalled();
  });

  it("offline disables the button", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    detectExtension.mockResolvedValue("ready");
    render(<KakaoMapSyncSection me={me} />);
    const button = await syncButton();
    expect(button).toBeDisabled();
    // The reason is read out with the button.
    const note = screen.getByText(/Syncing needs a connection/);
    expect(button).toHaveAttribute("aria-describedby", note.id);
    expect(note).toHaveTextContent("what you write saves when you're back online");
  });

  it("shows the last sync with its time, and says when one didn't finish", async () => {
    detectExtension.mockResolvedValue("ready");
    latest({ summary });
    render(<KakaoMapSyncSection me={me} />);
    expect(
      await within(section()).findByText(`Last sync: ${formatDateTime(T)}`),
    ).toBeInTheDocument();
    cleanup();
    latest({ status: "running", finishedAt: null });
    render(<KakaoMapSyncSection me={me} />);
    // Any unfinished run, however it stopped: no claim about a reload.
    expect(
      await within(section()).findByText(
        "The last sync didn't finish. Nothing of yours was removed. Start the sync again.",
      ),
    ).toBeInTheDocument();
  });

  it("ignores a run left by the old kakao-list import", async () => {
    detectExtension.mockResolvedValue("ready");
    latest({ source: "kakao_list", status: "running" });
    render(<KakaoMapSyncSection me={me} />);
    await syncButton();
    await waitFor(() => expect(api).toHaveBeenCalledWith("/api/import/runs/latest"));
    expect(within(section()).queryByText(/Start the sync again/)).toBeNull();
    expect(within(section()).queryByText(/Last sync/)).toBeNull();
  });

  it("leaving with a confirmation open drops the kept read", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    await startSync();
    await screen.findByRole("alertdialog");
    expect(forgetKakaoMapRead).not.toHaveBeenCalled();
    cleanup();
    expect(forgetKakaoMapRead).toHaveBeenCalledTimes(1);
  });

  it("a confirmation that ends after she left drops the kept read", async () => {
    let refuse: (e: unknown) => void = () => {};
    runKakaoMapSync.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    await startSync();
    cleanup();
    forgetKakaoMapRead.mockClear();
    await act(async () =>
      refuse(new KakaoMapSyncError("kakao_account_unconfirmed", { idTail: "1234" })),
    );
    await waitFor(() => expect(forgetKakaoMapRead).toHaveBeenCalledTimes(1));
  });

  it("the dialog's Sync waits for a connection", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    await startSync();
    const dialog = await screen.findByRole("alertdialog");
    const sync = within(dialog).getByRole("button", { name: "Sync" });
    expect(sync).toBeEnabled();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(sync).toBeDisabled();
    const reason = sync.getAttribute("aria-describedby");
    expect(reason && document.getElementById(reason)).toHaveTextContent(/needs a connection/);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(sync).toBeEnabled();
  });

  it("a confirmation that couldn't go out stays open to try again", async () => {
    runKakaoMapSync.mockRejectedValueOnce(
      new KakaoMapSyncError("kakao_account_unconfirmed", { nickname: "수지", idTail: "1234" }),
    );
    await startSync();
    runKakaoMapSync.mockRejectedValueOnce(new KakaoMapSyncError("offline"));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sync" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The connection dropped.");
    expect(forgetKakaoMapRead).not.toHaveBeenCalled();
    runKakaoMapSync.mockResolvedValueOnce(summary);
    await userEvent.click(within(dialog).getByRole("button", { name: "Sync" }));
    expect(runKakaoMapSync).toHaveBeenLastCalledWith(expect.any(Function), {
      account: "A",
      confirmAccount: "1234",
    });
  });
});
