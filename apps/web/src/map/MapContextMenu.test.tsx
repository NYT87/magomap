import type { NearbyResult, SearchResult } from "@magomap/domain";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ApiError, NetworkError } from "../api/client";
import { openUserDb } from "../data/db";
import { addToList, createList, savePlaceFromSearch } from "../data/writes";
import i18n from "../i18n";
import { setViewportWidth } from "../test/setup";
import type { ContextPress } from "./MapAdapter";

const fetchNearby = vi.fn<(point: { lat: number; lng: number }) => Promise<NearbyResult[]>>();
vi.mock("./nearby", async (orig) => ({
  ...(await orig<typeof import("./nearby")>()),
  fetchNearby: (point: { lat: number; lng: number }) => fetchNearby(point),
}));
const savePlaceToList = vi.fn<(input: unknown) => Promise<string>>();
vi.mock("../data/saveFromMap", () => ({
  savePlaceToList: (input: unknown) => savePlaceToList(input),
}));

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
    expect(await screen.findByText("No Kakao place found here.")).toBeVisible();
  });

  it("shows the offline, rate-limited and unavailable messages and saves nothing", async () => {
    const cases: [unknown, string][] = [
      [new NetworkError(), "Looking for places needs a connection."],
      [
        new ApiError(429, { error: "rate_limited" }),
        "That's a lot of lookups. Wait a moment, then try again.",
      ],
      [
        new ApiError(502, { error: "search_unavailable" }),
        "Place lookup isn't available right now.",
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
    expect(cafesRow).toHaveTextContent("Already in");
    expect(screen.getByRole("button", { name: /Bakeries/ })).not.toHaveTextContent("Already in");
  });

  it("offers only her own lists, then No list and New list", async () => {
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
    expect(screen.getByRole("button", { name: "No list" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New list" })).toBeVisible();
    expect(screen.queryByText("Kakao favourites")).toBeNull();
  });

  it("saving calls savePlaceToList with the chosen list, then opens the place", async () => {
    const cafes = await createList({ name: "Cafés", color: null });
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue("p_kakao_1");
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

  it("No list passes listId null", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue("p_kakao_1");
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /Place 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "No list" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/places/p_kakao_1"),
    );
    expect(savePlaceToList).toHaveBeenCalledExactlyOnceWith({ result: result("1"), listId: null });
  });

  it("New list passes the trimmed name", async () => {
    fetchNearby.mockResolvedValue([near("1", 5)]);
    savePlaceToList.mockResolvedValue("p_kakao_1");
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
    await userEvent.click(await screen.findByRole("button", { name: "No list" }));
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

    it("closes on Escape", async () => {
      fetchNearby.mockResolvedValue([near("1", 5)]);
      renderMenu();
      await screen.findByRole("button", { name: /Place 1/ });
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
