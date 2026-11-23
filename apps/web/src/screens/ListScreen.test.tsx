import type { ListRow, UserListRow } from "@magomap/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ListScreen } from "./ListScreen";

const sync = vi.hoisted(() => ({
  arrival: null as "downloading" | "waiting" | "unknown" | null,
}));
vi.mock("../data/useSyncStatus", () => ({ useListArrival: () => sync.arrival }));
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
    sync.arrival = "downloading";
    const view = render(<ListScreen id="l_kakao_1" />);
    expect(await screen.findByText("Still downloading this list's places…")).toBeInTheDocument();
    expect(screen.queryByText("No places in this list yet.")).toBeNull();
    view.unmount();
    // A sync that failed partway.
    sync.arrival = "waiting";
    const waiting = render(<ListScreen id="l_kakao_1" />);
    expect(
      await screen.findByText("This list's places will download at the next sync."),
    ).toBeInTheDocument();
    waiting.unmount();
    sync.arrival = null;
    render(<ListScreen id="l_kakao_1" />);
    expect(await screen.findByText("No places in this list yet.")).toBeInTheDocument();
  });

  it("an own empty list still says empty while a download is owed", async () => {
    await i18n.changeLanguage("en");
    const db = openUserDb("list-screen-own");
    await db.lists.put({ ...kakaoList, id: "l_own", provider: null, externalId: null });
    sync.arrival = "waiting";
    render(<ListScreen id="l_own" />);
    expect(await screen.findByText("No places in this list yet.")).toBeInTheDocument();
    sync.arrival = null;
  });

  it("says nothing for an empty Kakao list until it knows whether places are owed", async () => {
    await i18n.changeLanguage("en");
    const db = openUserDb("list-screen-unknown");
    await db.lists.put(kakaoList);
    await db.user_lists.put(access);
    sync.arrival = "unknown";
    render(<ListScreen id="l_kakao_1" />);
    expect(await screen.findByRole("heading", { name: "아내의 맛집" })).toBeInTheDocument();
    expect(screen.queryByText("No places in this list yet.")).toBeNull();
    expect(screen.queryByText(/download/i)).toBeNull();
    sync.arrival = null;
  });

  it("offers Duplicate on an own list, a Kakao list he owns and one he follows, not on Saved", async () => {
    await i18n.changeLanguage("en");
    sync.arrival = null;
    const db = openUserDb("list-screen-duplicate");
    await db.lists.bulkPut([
      { ...kakaoList, id: "own", provider: null, externalId: null, name: "빵 지도" },
      { ...kakaoList, id: "mine_kakao", name: "내 카페" },
      kakaoList,
    ]);
    await db.user_lists.bulkPut([
      { ...access, id: "ul_own", listId: "own", role: "owner" },
      { ...access, id: "ul_mine_kakao", listId: "mine_kakao", role: "owner" },
      access,
    ]);
    for (const id of ["own", "mine_kakao", "l_kakao_1"]) {
      const view = render(<ListScreen id={id} />);
      expect(await screen.findByRole("button", { name: "Duplicate" })).toBeInTheDocument();
      view.unmount();
    }
    const saved = render(<ListScreen id="__saved" />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    saved.unmount();
  });
});
