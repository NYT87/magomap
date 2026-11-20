import type { ListRow, UserListRow } from "@magomap/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ListScreen } from "./ListScreen";

const sync = vi.hoisted(() => ({ syncing: false }));
vi.mock("../data/useSyncStatus", () => ({ useSyncing: () => sync.syncing }));
const { openUserDb } = await import("../data/db");

const kakaoList: ListRow = {
  id: "l_kakao_1",
  provider: "kakao",
  externalId: "1",
  name: "아내의 맛집",
  description: null,
  color: null,
  ownerName: "지은",
  removedAtProvider: null,
  providerSnapshotAt: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const access: UserListRow = {
  id: "ul_l_kakao_1",
  listId: "l_kakao_1",
  role: "follower",
  removedAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

describe("ListScreen", () => {
  it("says a Kakao list whose places haven't arrived is still downloading, not empty", async () => {
    await i18n.changeLanguage("en");
    const db = openUserDb("list-screen");
    await db.lists.put(kakaoList);
    await db.user_lists.put(access);
    sync.syncing = true;
    const view = render(<ListScreen id="l_kakao_1" />);
    expect(await screen.findByText("Still downloading this list's places…")).toBeInTheDocument();
    expect(screen.queryByText("No places in this list yet.")).toBeNull();
    view.unmount();
    sync.syncing = false;
    render(<ListScreen id="l_kakao_1" />);
    expect(await screen.findByText("No places in this list yet.")).toBeInTheDocument();
  });
});
