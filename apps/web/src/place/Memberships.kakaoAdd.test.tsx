// The place page's lists and pending adds to her Kakao lists (#83, task 4).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { access, list, PLACE, seed } from "./testData";

const detect = vi.fn<() => Promise<"ready" | "missing">>();
vi.mock("../import/kakaoMap", () => ({ detectExtension: () => detect() }));
const push = vi.fn(async () => "pushed");
vi.mock("../lists/pushKakaoAdds", () => ({ pushKakaoAdds: () => push() }));
const { Memberships } = await import("./Memberships");

let n = 0;
beforeEach(async () => {
  n += 1;
  detect.mockReset();
  detect.mockResolvedValue("ready");
  push.mockClear();
  await i18n.changeLanguage("en");
});

const ADD_ID = `ka_l_kakao_4_${PLACE.id}`;

/** The place-page seed, plus a Kakao place id for the place and her own Kakao list 4 it isn't in. */
async function open(
  extra: (db: ReturnType<typeof openUserDb>) => Promise<unknown> = async () => {},
) {
  const db = openUserDb(`mka${n}`);
  await seed(db);
  await db.place_sources.put({
    id: "s_kakao_123",
    placeId: PLACE.id,
    provider: "kakao",
    externalId: "123",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  });
  await db.lists.put({ ...list("l_kakao_4", "새 리스트", "kakao"), externalId: "4" });
  await db.user_lists.put(access("l_kakao_4", "owner"));
  await extra(db);
  render(<Memberships placeId={PLACE.id} />);
  await screen.findByText("제주 카페", { selector: ".mm-chip__name" });
  return db;
}

const pendingRow = (failed: "list_missing" | null = null) => ({
  id: ADD_ID,
  listId: "l_kakao_4",
  placeId: PLACE.id,
  failed,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

describe("Memberships: her Kakao lists", () => {
  it("offers her own Kakao lists it isn't in, under Kakao Map; never one she follows", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    const panel = screen.getByRole("group", { name: "Add to list" });
    const kakao = within(panel).getByRole("group", { name: "Kakao Map" });
    expect(
      within(kakao)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["새 리스트"]);
    expect(within(panel).queryByRole("button", { name: "아내의 맛집" })).toBeNull();
  });

  it("adding to one keeps it pending, marks it, and pushes it where the extension is", async () => {
    const user = userEvent.setup();
    const db = await open();
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    await user.click(screen.getByRole("button", { name: "새 리스트" }));
    await waitFor(async () => expect((await db.kakao_adds.get(ADD_ID))?.deletedAt).toBeNull());
    const chip = (await screen.findByText("새 리스트", { selector: ".mm-chip__name" })).closest(
      ".mm-chip",
    ) as HTMLElement;
    expect(within(chip).getByText("Not yet in Kakao Map")).toBeInTheDocument();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("without the extension, it waits, and says when it will go", async () => {
    detect.mockResolvedValue("missing");
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(
      screen.getByText(/next time magomap is open in Chrome with the extension/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "새 리스트" }));
    await screen.findByText("Not yet in Kakao Map");
    expect(push).not.toHaveBeenCalled();
  });

  it("a pending add can be cancelled", async () => {
    const user = userEvent.setup();
    const db = await open((db) => db.kakao_adds.put(pendingRow()));
    await user.click(await screen.findByRole("button", { name: "Don't add to 새 리스트" }));
    await waitFor(async () => expect((await db.kakao_adds.get(ADD_ID))?.deletedAt).not.toBeNull());
    await waitFor(() =>
      expect(screen.queryByText("새 리스트", { selector: ".mm-chip__name" })).toBeNull(),
    );
  });

  it("a failed add says the list is gone from Kakao Map, and can be removed", async () => {
    await open((db) => db.kakao_adds.put(pendingRow("list_missing")));
    expect(await screen.findByText("This list is gone from Kakao Map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Don't add to 새 리스트" })).toBeEnabled();
  });

  it("offers no Kakao list for a place without a Kakao place id", async () => {
    const user = userEvent.setup();
    await open((db) => db.place_sources.delete("s_kakao_123"));
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(screen.queryByRole("group", { name: "Kakao Map" })).toBeNull();
  });
});
