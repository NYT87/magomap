import type { NearbyResult, SearchResult } from "@magomap/domain";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ApiError, NetworkError } from "../api/client";
import { openUserDb } from "../data/db";
import { pushesHeld } from "../data/events";
import type { SavedFromMap } from "../data/saveFromMap";
import { addToList, createList, savePlaceFromSearch } from "../data/writes";
import i18n from "../i18n";
import { setViewportWidth } from "../test/setup";
import type { ContextPress } from "./MapAdapter";

const fetchNearby = vi.fn<(point: { lat: number; lng: number }) => Promise<NearbyResult[]>>();
vi.mock("./nearby", async (orig) => ({
  ...(await orig<typeof import("./nearby")>()),
  fetchNearby: (point: { lat: number; lng: number }) => fetchNearby(point),
}));
const savePlaceToList = vi.fn<(input: unknown) => Promise<SavedFromMap>>();
vi.mock("../data/saveFromMap", () => ({
  savePlaceToList: (input: unknown) => savePlaceToList(input),
}));

const push = vi.fn(async (_db: unknown) => "pushed");
vi.mock("../lists/pushKakaoAdds", () => ({ pushKakaoAdds: (db: unknown) => push(db) }));

const { MapContextMenu } = await import("./MapContextMenu");

const result = (id: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  provider: "kakao",
  externalId: id,
  title: `Place ${id}`,
  address: `Address ${id}`,
  roadAddress: `Road ${id}`,
  category: "음식점 > 카페 > 커피전문점",
  phone: null,
  lat: 33.46,
  lng: 126.31,
  signedAt: 1_764_000_000_000,
  signature: "sig",
  ...extra,
});
const near = (id: string, distanceM: number, extra: Partial<SearchResult> = {}): NearbyResult => ({
  result: result(id, extra),
  distanceM,
});

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((ok, ko) => {
    resolve = ok;
    reject = ko;
  });
  return { promise, resolve, reject };
}

/** What a save reports (only the place id matters to the menu). */
const record = (placeId: string, listName: string | null = null): SavedFromMap => ({
  placeId,
  listId: null,
  listName,
  changed: true,
  rows: [],
  related: {},
  outbox: [],
  createdListId: null,
  addedItemId: null,
  kakaoAddId: null,
});

const PRESS: ContextPress = { point: { lat: 33.46, lng: 126.31 }, at: { x: 300, y: 200 } };

function Where() {
  const [location] = useLocation();
  return <output data-testid="location">{location}</output>;
}

/** The menu as the map opens it: shown while there is a press, gone once closed. */
function Host({ first }: { first: ContextPress }) {
  const [press, setPress] = useState<ContextPress | null>(first);
  return (
    <>
      <button type="button">before</button>
      <button type="button" onClick={() => setPress({ ...PRESS, point: { lat: 1, lng: 2 } })}>
        press again
      </button>
      {press && <MapContextMenu press={press} onClose={() => setPress(null)} />}
    </>
  );
}

/** A stand-in for the map: focused when it opens the menu. */
function Opener() {
  const [press, setPress] = useState<ContextPress | null>(null);
  return (
    <>
      <button type="button" onClick={() => setPress(PRESS)}>
        map
      </button>
      {press && <MapContextMenu press={press} onClose={() => setPress(null)} />}
    </>
  );
}

/** The menu until the map goes away (a "map gone" button). */
function Closable({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>
        map gone
      </button>
      {open && <MapContextMenu press={PRESS} onClose={() => {}} onSaved={onSaved} />}
    </>
  );
}

function renderMenu(press: ContextPress = PRESS) {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <Host first={press} />
      <Where />
    </Router>,
  );
}

let n = 0;
let db: ReturnType<typeof openUserDb>;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
  db = openUserDb(`menu${n}`);
  fetchNearby.mockReset();
  savePlaceToList.mockReset();
});
afterEach(() => {
  setViewportWidth(390);
  vi.restoreAllMocks();
});

describe("MapContextMenu", () => {
  it("shows looking, then the rows with name, category, address and distance", async () => {
    const answer = deferred<NearbyResult[]>();
    fetchNearby.mockReturnValue(answer.promise);
    renderMenu();
    expect(fetchNearby).toHaveBeenCalledWith(PRESS.point);
    const dialog = screen.getByRole("dialog", { name: "Save a place here" });
    expect(within(dialog).getByText("Looking for places nearby…")).toBeVisible();
    await act(async () => answer.resolve([near("1", 12), near("2", 30, { roadAddress: null })]));
    const first = await within(dialog).findByRole("button", { name: /Place 1/ });
    // Kakao's category path, shortened to its last step.
    expect(first).toHaveTextContent("커피전문점");
    expect(first).not.toHaveTextContent("음식점");
    expect(first).toHaveTextContent("Road 1");
    expect(first).toHaveTextContent("12 m");
    // No road address: the address.
    expect(within(dialog).getByRole("button", { name: /Place 2/ })).toHaveTextContent("Address 2");
    expect(screen.queryByText("Looking for places nearby…")).toBeNull();
  });

  it('shows "No Kakao place found here" for an empty answer', async () => {
    fetchNearby.mockResolvedValue([]);
    renderMenu();
    expect(
      await screen.findByText("No Kakao place found here. Try pressing closer to the place."),
    ).toBeVisible();
  });

  it("shows the offline, rate-limited and unavailable messages and saves nothing", async () => {
    const cases: [unknown, string][] = [
      [new NetworkError(), "Looking for places needs a connection. Try again once you're online."],
      [
        new ApiError(429, { error: "rate_limited" }),
        "That's a lot of lookups. Wait a moment, then try again.",
      ],
      [
        new ApiError(502, { error: "search_unavailable" }),
        "Place lookup isn't available right now. Try again, or search for the place by name.",
      ],
    ];
    for (const [error, message] of cases) {
      fetchNearby.mockRejectedValueOnce(error);
      const view = renderMenu();
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.queryAllByRole("button", { name: /Place/ })).toHaveLength(0);
      view.unmount();
    }
    expect(savePlaceToList).not.toHaveBeenCalled();
  });

  it("a place she already saved is marked saved, and step two marks the lists she is in", async () => {
    const cafes = await createList({ name: "Cafés", color: null });
    await createList({ name: "Bakeries", color: null });
    await savePlaceFromSearch(result("1"));
    await addToList(cafes, "p_kakao_1");
    fetchNearby.mockResolvedValue([near("1", 5), near("2", 9)]);
    renderMenu();
    const saved = await screen.findByRole("button", { name: /Place 1/ });
    await waitFor(() => expect(saved).toHaveTextContent("Saved"));
    expect(screen.getByRole("button", { name: /Place 2/ })).not.toHaveTextContent("Saved");
    await userEvent.click(saved);
    const cafesRow = await screen.findByRole("button", { name: /Cafés/ });
    expect(cafesRow).toHaveTextContent("Already in this list");
    expect(screen.getByRole("button", { name: /Bakeries/ })).not.toHaveTextContent("Already in");
  });

  /** Her own Kakao list 8, as a Kakao Map sync leaves it. */
  async function herKakaoList() {
    await db.lists.put({
      id: "l_kakao_8",
      provider: "kakao",
      externalId: "8",
      name: "제주 맛집",
      description: null,
      color: null,
      ownerName: null,
      removedAtProvider: null,
      providerSnapshotAt: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await db.user_lists.put({
      id: "ul_l_kakao_8",
      listId: "l_kakao_8",
      role: "owner",
      removedAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
  }

  it("offers her own Kakao lists under Kakao Map, for a place Kakao Map can add", async () => {
    await herKakaoList();
    fetchNearby.mockResolvedValue([near("1", 5)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    const kakao = await screen.findByRole("list", { name: "Kakao Map" });
    expect(within(kakao).getByRole("button", { name: /제주 맛집/ })).toBeVisible();
  });

  it("saving to her Kakao list pushes it to Kakao Map once the hold lets go", async () => {
    await herKakaoList();
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue({
      ...record("p_kakao_1", "제주 맛집"),
      listId: "l_kakao_8",
      kakaoAddId: "ka_l_kakao_8_p_kakao_1",
    });
    push.mockClear();
    let letGo: () => void = () => {};
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <MapContextMenu
          press={PRESS}
          onClose={() => {}}
          onSaved={(_saved, release) => {
            letGo = release;
          }}
        />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: /제주 맛집/ }));
    await waitFor(() =>
      expect(savePlaceToList).toHaveBeenCalledWith({ result: result("1"), listId: "l_kakao_8" }),
    );
    // Not while its Undo is offered.
    await new Promise((r) => setTimeout(r, 20));
    expect(push).not.toHaveBeenCalled();
    letGo();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("offers no Kakao list for a place Kakao Map can't add by id", async () => {
    await herKakaoList();
    fetchNearby.mockResolvedValue([near("x1", 5)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place x1/ }));
    await screen.findByRole("button", { name: "New list" });
    expect(screen.queryByRole("list", { name: "Kakao Map" })).toBeNull();
  });

  it("opened with a place found in search, goes straight to its lists, without a lookup", async () => {
    await createList({ name: "Cafés", color: null });
    savePlaceToList.mockResolvedValue(record("p_kakao_7"));
    const onClose = vi.fn();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <MapContextMenu press={PRESS} found={near("7", 0)} onClose={onClose} />
      </Router>,
    );
    expect(await screen.findByRole("button", { name: /Cafés/ })).toBeVisible();
    expect(screen.getByText("Place 7")).toBeVisible();
    expect(fetchNearby).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Cafés/ }));
    await waitFor(() =>
      expect(savePlaceToList).toHaveBeenCalledWith({
        result: result("7"),
        listId: expect.any(String),
      }),
    );
  });

  it("opened with a found place, Back closes it: there are no other places to go back to", async () => {
    const onClose = vi.fn();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <MapContextMenu press={PRESS} found={near("7", 0)} onClose={onClose} />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Back to search" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers only her own lists, then Save without a list and New list", async () => {
    await createList({ name: "Cafés", color: null });
    await db.lists.put({
      id: "l_kakao_9",
      provider: "kakao",
      externalId: "9",
      name: "Kakao favourites",
      description: null,
      color: null,
      ownerName: null,
      removedAtProvider: null,
      providerSnapshotAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    fetchNearby.mockResolvedValue([near("1", 5)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    expect(await screen.findByRole("button", { name: /Cafés/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save without a list" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New list" })).toBeVisible();
    expect(screen.queryByText("Kakao favourites")).toBeNull();
  });

  it("saving calls savePlaceToList with the chosen list, then opens the place", async () => {
    const cafes = await createList({ name: "Cafés", color: null });
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue(record("p_kakao_1"));
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Cafés/ }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/places/p_kakao_1"),
    );
    expect(savePlaceToList).toHaveBeenCalledExactlyOnceWith({
      result: result("1"),
      listId: cafes,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Save without a list passes listId null", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue(record("p_kakao_1"));
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/places/p_kakao_1"),
    );
    expect(savePlaceToList).toHaveBeenCalledExactlyOnceWith({ result: result("1"), listId: null });
  });

  it("New list passes the trimmed name", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue(record("p_kakao_1"));
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "New list" }));
    await userEvent.type(screen.getByRole("textbox", { name: "List name" }), "  Jeju eats ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/places/p_kakao_1"),
    );
    expect(savePlaceToList).toHaveBeenCalledExactlyOnceWith({
      result: result("1"),
      listId: null,
      newListName: "Jeju eats",
    });
  });

  it("the save button is disabled for a blank new-list name", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "New list" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "List name" }), "   ");
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest("form") as HTMLFormElement);
    expect(savePlaceToList).not.toHaveBeenCalled();
  });

  it("says so when the save fails, and stays", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockRejectedValue(new Error("disk full"));
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save this place. Try again.",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("goes back from the lists to the places", async () => {
    fetchNearby.mockResolvedValue([near("1", 5), near("2", 9)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Back to the places" }));
    expect(await screen.findByRole("button", { name: /Place 2/ })).toBeVisible();
  });

  it("keeps focus in the menu from one step to the other", async () => {
    await createList({ name: "Cafés", color: null });
    fetchNearby.mockResolvedValue([near("1", 5), near("2", 9)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 2/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Cafés/ })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Back to the places" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Place 2/ })).toHaveFocus());
  });

  it("a newer press replaces the menu and a late answer for the older one is ignored", async () => {
    const older = deferred<NearbyResult[]>();
    const newer = deferred<NearbyResult[]>();
    fetchNearby.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    setViewportWidth(1200);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "press again" }));
    expect(fetchNearby).toHaveBeenLastCalledWith({ lat: 1, lng: 2 });
    await act(async () => newer.resolve([near("new", 4)]));
    await act(async () => older.resolve([near("old", 3)]));
    expect(await screen.findByRole("button", { name: /Place new/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Place old/ })).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("shows distances of a kilometre or more in km, with one decimal", async () => {
    fetchNearby.mockResolvedValue([near("1", 999), near("2", 1000), near("3", 1234)]);
    renderMenu();
    expect(await screen.findByRole("button", { name: /Place 1/ })).toHaveTextContent("999 m");
    expect(screen.getByRole("button", { name: /Place 2/ })).toHaveTextContent("1.0 km");
    expect(screen.getByRole("button", { name: /Place 3/ })).toHaveTextContent("1.2 km");
  });

  it("is called 이 위치에서 장소 저장 in Korean, and marks a list 이미 이 리스트에 있어요", async () => {
    await i18n.changeLanguage("ko");
    const cafes = await createList({ name: "Cafés", color: null });
    await savePlaceFromSearch(result("1"));
    await addToList(cafes, "p_kakao_1");
    fetchNearby.mockResolvedValue([near("1", 1500)]);
    renderMenu();
    expect(screen.getByRole("dialog", { name: "이 위치에서 장소 저장" })).toBeVisible();
    const row = await screen.findByRole("button", { name: /Place 1/ });
    expect(row).toHaveTextContent("1.5km");
    await waitFor(() => expect(row).toHaveTextContent("저장됨"));
    await userEvent.click(row);
    expect(await screen.findByRole("button", { name: /Cafés/ })).toHaveTextContent(
      "이미 이 리스트에 있어요",
    );
  });

  it("offers Try again after a failed lookup or none found, for the same point", async () => {
    const cases: [() => void, string][] = [
      [() => fetchNearby.mockRejectedValueOnce(new NetworkError()), "needs a connection"],
      [
        () => fetchNearby.mockRejectedValueOnce(new ApiError(429, { error: "rate_limited" })),
        "lot of lookups",
      ],
      [
        () => fetchNearby.mockRejectedValueOnce(new ApiError(502, { error: "search_unavailable" })),
        "isn't available",
      ],
      [() => fetchNearby.mockResolvedValueOnce([]), "No Kakao place"],
    ];
    for (const [fail, message] of cases) {
      fetchNearby.mockReset();
      fail();
      fetchNearby.mockResolvedValueOnce([near("1", 5)]);
      const view = renderMenu();
      expect(await screen.findByText(new RegExp(message))).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("button", { name: /Place 1/ })).toBeVisible();
      expect(fetchNearby).toHaveBeenCalledTimes(2);
      expect(fetchNearby).toHaveBeenLastCalledWith(PRESS.point);
      // The answer's first place takes the focus the button had.
      await waitFor(() => expect(screen.getByRole("button", { name: /Place 1/ })).toHaveFocus());
      view.unmount();
    }
  });

  it("Try again sends no second lookup while one is still running", async () => {
    fetchNearby.mockRejectedValueOnce(new NetworkError());
    const again = deferred<NearbyResult[]>();
    fetchNearby.mockReturnValueOnce(again.promise);
    renderMenu();
    const retry = await screen.findByRole("button", { name: "Try again" });
    await userEvent.click(retry);
    // Still there, still focused, but it does nothing until the answer is in.
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveFocus();
    await userEvent.click(retry);
    await userEvent.click(retry);
    expect(fetchNearby).toHaveBeenCalledTimes(2);
    await act(async () => again.resolve([near("1", 5)]));
    expect(await screen.findByRole("button", { name: /Place 1/ })).toBeVisible();
  });

  it("announces looking, then how many were found, in a status region apart from the list", async () => {
    const answer = deferred<NearbyResult[]>();
    fetchNearby.mockReturnValue(answer.promise);
    renderMenu();
    const status = within(screen.getByRole("dialog")).getByRole("status");
    expect(status).toHaveTextContent("Looking for places nearby…");
    await act(async () => answer.resolve([near("1", 5), near("2", 9)]));
    await waitFor(() => expect(status).toHaveTextContent("2 places found"));
    // The same region all along, and the list isn't read out with it.
    expect(within(screen.getByRole("dialog")).getByRole("status")).toBe(status);
    expect(within(status).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: /Place 1/ })).toBeVisible();
  });

  it("announces one place, none, and a failure in the same region", async () => {
    fetchNearby.mockResolvedValueOnce([near("1", 5)]);
    let view = renderMenu();
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
        "1 place found",
      ),
    );
    view.unmount();
    fetchNearby.mockResolvedValueOnce([]);
    view = renderMenu();
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
        "No Kakao place found here.",
      ),
    );
    view.unmount();
    fetchNearby.mockRejectedValueOnce(new NetworkError());
    renderMenu();
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
        "needs a connection",
      ),
    );
  });

  it("while saving, the lists stay focusable (aria-disabled) and a second tap saves nothing", async () => {
    const cafes = await createList({ name: "Cafés", color: null });
    fetchNearby.mockResolvedValue([near("1", 5)]);
    const pending = deferred<SavedFromMap>();
    savePlaceToList.mockReturnValue(pending.promise);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    const row = await screen.findByRole("button", { name: /Cafés/ });
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).not.toBeDisabled();
    expect(row).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Save without a list" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to the places" }));
    await userEvent.click(row);
    expect(savePlaceToList).toHaveBeenCalledExactlyOnceWith({ result: result("1"), listId: cafes });
    expect(screen.getByRole("button", { name: /Cafés/ })).toBeVisible();
    // A failure leaves her where she was, with the message.
    await act(async () => pending.reject(new Error("disk full")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(screen.getByRole("button", { name: /Cafés/ })).toHaveFocus();
    expect(screen.getByRole("button", { name: /Cafés/ })).not.toHaveAttribute("aria-disabled");
  });

  it("Escape on the lists goes back to the places; Escape on the places closes", async () => {
    fetchNearby.mockResolvedValue([near("1", 5), near("2", 9)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 2/ }));
    await screen.findByRole("button", { name: "Save without a list" });
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: /Place 2/ })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a save still running when a newer press replaces the menu neither opens it nor closes the new one", async () => {
    fetchNearby.mockResolvedValueOnce([near("1", 5)]).mockResolvedValueOnce([near("2", 7)]);
    const pending = deferred<SavedFromMap>();
    savePlaceToList.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    const { hook } = memoryLocation({ path: "/" });
    const view = render(
      <Router hook={hook}>
        <MapContextMenu press={PRESS} onClose={onClose} />
        <Where />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    // The same menu, given a newer press.
    view.rerender(
      <Router hook={hook}>
        <MapContextMenu press={{ ...PRESS, point: { lat: 1, lng: 2 } }} onClose={onClose} />
        <Where />
      </Router>,
    );
    expect(await screen.findByRole("button", { name: /Place 2/ })).toBeVisible();
    await act(async () => pending.resolve(record("p_kakao_1")));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(pushesHeld(db)).toBe(false);
    expect(screen.getByRole("button", { name: /Place 2/ })).toBeVisible();
    // Nor does a late failure show on the newer menu.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a save failing after a newer press says nothing on the newer menu", async () => {
    fetchNearby.mockResolvedValueOnce([near("1", 5)]).mockResolvedValueOnce([near("2", 7)]);
    const pending = deferred<SavedFromMap>();
    savePlaceToList.mockReturnValue(pending.promise);
    const { hook } = memoryLocation({ path: "/" });
    const view = render(
      <Router hook={hook}>
        <MapContextMenu press={PRESS} onClose={() => {}} />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    view.rerender(
      <Router hook={hook}>
        <MapContextMenu press={{ ...PRESS, point: { lat: 1, lng: 2 } }} onClose={() => {}} />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Place 2/ }));
    await act(async () => pending.reject(new Error("disk full")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save without a list" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("sets Save without a list apart from her lists", async () => {
    await createList({ name: "Cafés", color: null });
    fetchNearby.mockResolvedValue([near("1", 5)]);
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    const mine = await screen.findByRole("list", { name: "Save to…" });
    expect(within(mine).getByRole("button", { name: /Cafés/ })).toBeVisible();
    expect(within(mine).queryByRole("button", { name: "Save without a list" })).toBeNull();
    expect(within(mine).queryByRole("button", { name: "New list" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save without a list" })).toBeVisible();
  });

  it("hands what it saved on, holding the sending until the confirmation lets go", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    const saved = record("p_kakao_1", "Cafés");
    savePlaceToList.mockResolvedValue(saved);
    const onSaved = vi.fn<(s: SavedFromMap, release: () => void) => void>();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <MapContextMenu press={PRESS} onClose={() => {}} onSaved={onSaved} />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onSaved.mock.calls[0]?.[0]).toBe(saved);
    expect(pushesHeld(db)).toBe(true);
    onSaved.mock.calls[0]?.[1]();
    expect(pushesHeld(db)).toBe(false);
  });

  it("lets go of the hold when the save fails", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockRejectedValue(new Error("disk full"));
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    await screen.findByRole("alert");
    expect(pushesHeld(db)).toBe(false);
  });

  it("a save still running when the menu closes neither opens the place nor keeps a hold", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    const pending = deferred<SavedFromMap>();
    savePlaceToList.mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <Closable onSaved={onSaved} />
        <Where />
      </Router>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save without a list" }));
    expect(pushesHeld(db)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "map gone" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => pending.resolve(record("p_kakao_1")));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(pushesHeld(db)).toBe(false);
  });

  it("Escape closes it and returns focus", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <Opener />
      </Router>,
    );
    const opener = screen.getByRole("button", { name: "map" });
    await userEvent.click(opener);
    expect(await screen.findByRole("dialog")).toBeVisible();
    await waitFor(() => expect(opener).not.toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  describe("on a desktop", () => {
    beforeEach(() => setViewportWidth(1200));

    it("is a popover at the pressed spot, not a sheet", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      renderMenu();
      const dialog = screen.getByRole("dialog", { name: "Save a place here" });
      expect(dialog).toHaveClass("mm-map-menu--popover");
      expect(dialog.style.left).toBe("300px");
      expect(dialog.style.top).toBe("200px");
      expect(document.querySelector(".mm-sheet")).toBeNull();
    });

    it("stays inside the window near its right and bottom edges", async () => {
      fetchNearby.mockResolvedValue([]);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 300,
        height: 200,
      } as DOMRect);
      renderMenu({ ...PRESS, at: { x: window.innerWidth - 10, y: window.innerHeight - 10 } });
      const dialog = screen.getByRole("dialog", { name: "Save a place here" });
      expect(dialog.style.left).toBe(`${window.innerWidth - 8 - 300}px`);
      expect(dialog.style.top).toBe(`${window.innerHeight - 8 - 200}px`);
    });

    it("closes on a press elsewhere", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      renderMenu();
      const row = await screen.findByRole("button", { name: /Place 1/ });
      fireEvent.pointerDown(row);
      expect(screen.getByRole("dialog")).toBeVisible();
      fireEvent.pointerDown(screen.getByRole("button", { name: "before" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("Escape on the lists goes back to the places", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      renderMenu();
      await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
      await screen.findByRole("button", { name: "Save without a list" });
      await userEvent.keyboard("{Escape}");
      expect(await screen.findByRole("button", { name: /Place 1/ })).toBeVisible();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes when focus leaves it, and focus goes back to the map", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      const { hook } = memoryLocation({ path: "/" });
      render(
        <Router hook={hook}>
          <Opener />
          <button type="button">elsewhere</button>
        </Router>,
      );
      const opener = screen.getByRole("button", { name: "map" });
      await userEvent.click(opener);
      await screen.findByRole("button", { name: /Place 1/ });
      act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(opener).toHaveFocus();
    });

    it("stays open while focus moves inside it, from one step to the other", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      renderMenu();
      await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
      await userEvent.tab();
      await userEvent.click(screen.getByRole("button", { name: "Back to the places" }));
      expect(screen.getByRole("dialog")).toBeVisible();
    });

    it("moves back inside the window when the window shrinks or turns", async () => {
      fetchNearby.mockResolvedValue([]);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 300,
        height: 200,
      } as DOMRect);
      const was = { w: window.innerWidth, h: window.innerHeight };
      try {
        renderMenu({ ...PRESS, at: { x: 600, y: 500 } });
        const dialog = screen.getByRole("dialog", { name: "Save a place here" });
        expect(dialog.style.left).toBe("600px");
        Object.defineProperty(window, "innerWidth", { value: 700, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(dialog.style.left).toBe(`${700 - 8 - 300}px`);
        expect(dialog.style.top).toBe(`${600 - 8 - 200}px`);
      } finally {
        Object.defineProperty(window, "innerWidth", { value: was.w, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: was.h, configurable: true });
      }
    });

    it("closes on Escape", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      renderMenu();
      await screen.findByRole("button", { name: /Place 1/ });
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
