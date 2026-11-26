// The library is read once for the whole app, not once per screen (audit item 7).
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { openUserDb } from "./db";
import { LibraryProvider, useListPlaces, useLists, usePlaceMemberships } from "./queries";

function Screens() {
  const lists = useLists();
  const rows = useListPlaces("l1");
  const memberships = usePlaceMemberships("p1");
  return (
    <p>
      {lists && rows && memberships
        ? `lists ${lists.mine.length}, rows ${rows.length}, in ${memberships.length}`
        : "loading"}
    </p>
  );
}

const base = { createdAt: 1, updatedAt: 1, deletedAt: null };

describe("LibraryProvider", () => {
  it("reads the library once for every screen under it, and again after a write", async () => {
    const db = openUserDb("libonce");
    await db.places.put({
      id: "p1",
      title: "제주 카페",
      lat: 33.5,
      lng: 126.5,
      address: null,
      roadAddress: null,
      category: null,
      phone: null,
      ...base,
    } as never);
    await db.lists.put({
      id: "l1",
      provider: null,
      externalId: null,
      name: "카페",
      description: null,
      color: null,
      ownerName: null,
      removedAtProvider: null,
      providerSnapshotAt: null,
      ...base,
    });
    await db.list_items.put({
      id: "i1",
      listId: "l1",
      placeId: "p1",
      position: 0,
      addedAt: 1,
      externalId: null,
      providerNote: null,
      providerColor: null,
      removedAtProvider: null,
      providerSnapshotAt: null,
      ...base,
    });
    const reads = vi.spyOn(db.list_items, "toArray");
    render(
      <LibraryProvider>
        <Screens />
        <Screens />
      </LibraryProvider>,
    );
    await screen.findAllByText("lists 1, rows 1, in 1");
    expect(reads).toHaveBeenCalledTimes(1);
    await db.list_items.update("i1", { removedAtProvider: null, updatedAt: 2 });
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
  });

  it("without it, each screen still reads for itself", async () => {
    openUserDb("libalone");
    render(<Screens />);
    expect(await screen.findByText("lists 0, rows 0, in 0")).toBeInTheDocument();
  });
});
