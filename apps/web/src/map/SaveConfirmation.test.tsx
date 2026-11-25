import type { SearchResult } from "@magomap/domain";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { openUserDb } from "../data/db";
import { type SavedFromMap, savePlaceToList } from "../data/saveFromMap";
import { createList, savePlaceFromSearch } from "../data/writes";
import i18n from "../i18n";
import { SAVE_CONFIRMATION_MS, SaveConfirmation } from "./SaveConfirmation";

const result = (id: string): SearchResult => ({
  provider: "kakao",
  externalId: id,
  title: `Place ${id}`,
  address: "Address",
  roadAddress: null,
  category: null,
  phone: null,
  lat: 33.46,
  lng: 126.31,
  signedAt: 1_764_000_000_000,
  signature: "sig",
});

function Where() {
  const [location] = useLocation();
  return <span data-testid="location">{location}</span>;
}

/** As the map shows it: one confirmation at a time, for the latest save. */
function Host({ first, release }: { first: SavedFromMap; release: () => void }) {
  const [shown, setShown] = useState<{ saved: SavedFromMap; n: number } | null>({
    saved: first,
    n: 0,
  });
  const [next, setNext] = useState<SavedFromMap | null>(null);
  return (
    <>
      <button type="button" onClick={() => next && setShown({ saved: next, n: 1 })}>
        save again
      </button>
      {shown && (
        <SaveConfirmation
          key={shown.n}
          saved={shown.saved}
          release={release}
          onDone={() => setShown(null)}
        />
      )}
      <Where />
      <HostNext set={setNext} />
    </>
  );
}
let setNextSaved: (s: SavedFromMap) => void = () => {};
function HostNext({ set }: { set: (s: SavedFromMap) => void }) {
  setNextSaved = set;
  return null;
}

function show(saved: SavedFromMap, path = `/places/${saved.placeId}`) {
  const release = vi.fn();
  const { hook } = memoryLocation({ path });
  const view = render(
    <Router hook={hook}>
      <Host first={saved} release={release} />
    </Router>,
  );
  return { release, view };
}

let n = 0;
let db: ReturnType<typeof openUserDb>;
beforeEach(async () => {
  n += 1;
  db = openUserDb(`confirm${n}`);
  await i18n.changeLanguage("en");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SaveConfirmation", () => {
  it("names the list, politely, with Undo", async () => {
    const list = await createList({ name: "Cafés", color: null });
    show(await savePlaceToList({ result: result("1"), listId: list }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved to Cafés");
    expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  it("says Saved for a save without a list", async () => {
    show(await savePlaceToList({ result: result("1"), listId: null }));
    expect(screen.getByRole("status")).toHaveTextContent(/^Saved$/);
  });

  it("offers no Undo when the save changed nothing", async () => {
    const list = await createList({ name: "Cafés", color: null });
    await savePlaceToList({ result: result("1"), listId: list });
    show(await savePlaceToList({ result: result("1"), listId: list }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved to Cafés");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo of a new place in a new list takes both back, and goes back to the map", async () => {
    const saved = await savePlaceToList({ result: result("1"), listId: null, newListName: "New" });
    const { release } = show(saved);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await db.places.count()).toBe(0);
    expect(await db.user_places.count()).toBe(0);
    expect(await db.lists.count()).toBe(0);
    expect(await db.list_items.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(release).toHaveBeenCalled();
  });

  it("Undo of a saved place added to a list only takes it out of the list, and stays", async () => {
    await savePlaceFromSearch(result("1"));
    const list = await createList({ name: "Cafés", color: null });
    const saved = await savePlaceToList({ result: result("1"), listId: list });
    show(saved);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((await db.list_items.toArray()).filter((i) => i.deletedAt == null)).toHaveLength(0);
    expect(await db.user_places.count()).toBe(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/places/p_kakao_1");
  });

  it("goes away by itself after a few seconds, letting the sending go", async () => {
    const saved = await savePlaceToList({ result: result("1"), listId: null });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { release } = show(saved);
    expect(SAVE_CONFIRMATION_MS).toBeGreaterThanOrEqual(4_000);
    act(() => {
      vi.advanceTimersByTime(SAVE_CONFIRMATION_MS - 100);
    });
    expect(screen.getByRole("status")).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("stays while she is on it (pointer or focus)", async () => {
    const saved = await savePlaceToList({ result: result("1"), listId: null, newListName: "L" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    show(saved);
    act(() => screen.getByRole("button", { name: "Undo" }).focus());
    act(() => {
      vi.advanceTimersByTime(SAVE_CONFIRMATION_MS * 3);
    });
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("goes away on her next action elsewhere", async () => {
    const { release } = show(await savePlaceToList({ result: result("1"), listId: null }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "save again" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("a second save replaces it", async () => {
    const first = await savePlaceToList({ result: result("1"), listId: null });
    const list = await createList({ name: "Bakeries", color: null });
    const second = await savePlaceToList({ result: result("2"), listId: list });
    const { release } = show(first);
    act(() => setNextSaved(second));
    act(() => screen.getByRole("button", { name: "save again" }).click());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Saved to Bakeries");
    // The first one's hold is let go; the second keeps its own.
    expect(release).toHaveBeenCalledOnce();
  });
});
