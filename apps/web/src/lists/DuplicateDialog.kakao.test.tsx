import type { ListRow } from "@magomap/domain";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { openUserDb } from "../data/db";
import i18n from "../i18n";

const detect = vi.fn<() => Promise<"ready" | "missing">>();
vi.mock("../import/kakaoMap", () => ({ detectExtension: () => detect() }));
const copy = vi.fn();
vi.mock("./duplicateToKakao", async () => {
  class KakaoCopyError extends Error {
    constructor(
      readonly code: string,
      readonly folderId?: number,
      readonly added?: number,
    ) {
      super(code);
    }
  }
  return { KakaoCopyError, duplicateToKakao: (input: unknown) => copy(input) };
});
const { DuplicateDialog } = await import("./DuplicateDialog");
const { KakaoCopyError } = await import("./duplicateToKakao");

const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
const kakao: ListRow = {
  id: "l1",
  provider: "kakao",
  externalId: "1",
  name: "제주 카페",
  description: null,
  color: null,
  ownerName: null,
  removedAtProvider: null,
  providerSnapshotAt: 1,
  ...base,
};
const own: ListRow = { ...kakao, id: "l2", provider: null, externalId: null };

let n = 0;
beforeEach(async () => {
  n += 1;
  detect.mockReset();
  copy.mockReset();
  await i18n.changeLanguage("en");
});

async function open(list: ListRow) {
  const db = openUserDb(`d2kdlg${n}`);
  await db.lists.put(list);
  const location = memoryLocation({ path: "/lists/x", record: true });
  render(
    <Router hook={location.hook}>
      <DuplicateDialog list={list} onClose={vi.fn()} />
    </Router>,
  );
}
const kakaoButton = () => screen.queryByRole("button", { name: "Copy to Kakao Map" });

describe("DuplicateDialog: Copy to Kakao Map", () => {
  it("is not offered for a list that isn't a Kakao list", async () => {
    detect.mockResolvedValue("ready");
    await open(own);
    await screen.findByRole("button", { name: "Copy in magomap" });
    expect(kakaoButton()).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });

  it("is offered when the extension answers", async () => {
    detect.mockResolvedValue("ready");
    await open(kakao);
    expect(await screen.findByRole("button", { name: "Copy to Kakao Map" })).toBeEnabled();
  });

  it("is absent, with a line saying why, when the extension doesn't answer; the local copy stays", async () => {
    detect.mockResolvedValue("missing");
    await open(kakao);
    expect(await screen.findByText(/needs the magomap extension/i)).toBeInTheDocument();
    expect(kakaoButton()).toBeNull();
    expect(screen.getByRole("button", { name: "Copy in magomap" })).toBeEnabled();
  });

  it("copies with the typed name and shows what was added and left out", async () => {
    detect.mockResolvedValue("ready");
    copy.mockResolvedValue({ folderId: 9, added: 12, skipped: 0, leftOut: 2, synced: true });
    const user = userEvent.setup();
    await open(kakao);
    await user.click(await screen.findByRole("button", { name: "Copy to Kakao Map" }));
    expect(copy).toHaveBeenCalledWith({ sourceListId: "l1", name: "제주 카페 (copy)" });
    expect(await screen.findByText(/12 places added/i)).toBeInTheDocument();
    expect(screen.getByText(/2 places left out/i)).toBeInTheDocument();
  });

  it("says so when the sync afterwards didn't work", async () => {
    detect.mockResolvedValue("ready");
    copy.mockResolvedValue({ folderId: 9, added: 1, skipped: 0, leftOut: 0, synced: false });
    const user = userEvent.setup();
    await open(kakao);
    await user.click(await screen.findByRole("button", { name: "Copy to Kakao Map" }));
    expect(await screen.findByText(/Sync from Kakao Map/)).toBeInTheDocument();
  });

  it("shows why a copy failed and keeps the dialog open", async () => {
    detect.mockResolvedValue("ready");
    copy.mockRejectedValue(new KakaoCopyError("account_mismatch"));
    const user = userEvent.setup();
    await open(kakao);
    await user.click(await screen.findByRole("button", { name: "Copy to Kakao Map" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/different Kakao Map account/i);
    expect(screen.getByRole("button", { name: "Copy to Kakao Map" })).toBeEnabled();
  });

  it("after a partial failure shows how many were added, and Try again resumes the same list", async () => {
    detect.mockResolvedValue("ready");
    copy.mockRejectedValueOnce(new KakaoCopyError("partial", 9, 53));
    copy.mockResolvedValueOnce({ folderId: 9, added: 7, skipped: 53, leftOut: 0, synced: true });
    const user = userEvent.setup();
    await open(kakao);
    await user.click(await screen.findByRole("button", { name: "Copy to Kakao Map" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/53 places/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
    expect(copy.mock.calls[1]?.[0]).toEqual({
      sourceListId: "l1",
      name: "제주 카페 (copy)",
      resume: { folderId: 9 },
    });
  });

  it("keeps filling the same list when a retry fails before adding anything", async () => {
    detect.mockResolvedValue("ready");
    copy.mockRejectedValueOnce(new KakaoCopyError("partial", 9, 53));
    copy.mockRejectedValueOnce(new KakaoCopyError("offline"));
    copy.mockResolvedValueOnce({ folderId: 9, added: 7, skipped: 53, leftOut: 0, synced: true });
    const user = userEvent.setup();
    await open(kakao);
    await user.click(await screen.findByRole("button", { name: "Copy to Kakao Map" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText(/offline/i);
    await user.click(screen.getByRole("button", { name: /Try again|Copy to Kakao Map/ }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(3));
    expect(copy.mock.calls[2]?.[0]).toMatchObject({ resume: { folderId: 9 } });
  });

  it("can't be cancelled while a copy is running", async () => {
    detect.mockResolvedValue("ready");
    copy.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    await open(kakao);
    await user.click(await screen.findByRole("button", { name: "Copy to Kakao Map" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(await screen.findByText("Copying to Kakao Map…")).toBeInTheDocument();
  });

  it("doesn't start a second copy while one is running", async () => {
    detect.mockResolvedValue("ready");
    let finish: (v: unknown) => void = () => undefined;
    copy.mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    await open(kakao);
    const button = await screen.findByRole("button", { name: "Copy to Kakao Map" });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy in magomap" })).toBeDisabled();
    finish({ folderId: 1, added: 0, skipped: 0, leftOut: 0, synced: true });
    await screen.findByText(/places added/i);
    expect(copy).toHaveBeenCalledTimes(1);
  });
});
