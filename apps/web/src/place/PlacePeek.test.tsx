import type { PlaceRow } from "@magomap/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import en from "../i18n/en.json";
import { MapStageProvider, useMapStage } from "../map/MapStage";
import { PlacePeek } from "./PlacePeek";
import { list, member, PLACE, seed } from "./testData";

function Probe() {
  const [location] = useLocation();
  const { focus } = useMapStage();
  return (
    <>
      <output data-testid="location">{location}</output>
      <output data-testid="focus">{focus ? `${focus.lat},${focus.lng}` : ""}</output>
    </>
  );
}

function renderPeek(id: string) {
  const { hook } = memoryLocation({ path: `/places/${id}` });
  return render(
    <Router hook={hook}>
      <MapStageProvider>
        <PlacePeek id={id} />
        <Probe />
      </MapStageProvider>
    </Router>,
  );
}

let n = 0;
let db: ReturnType<typeof openUserDb>;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
  db = openUserDb(`peek${n}`);
});

const put = (extra: Partial<PlaceRow>) => db.places.put({ ...PLACE, ...extra });

describe("PlacePeek", () => {
  it("is a region named by the place, with its name as a level 2 heading and the category", async () => {
    await seed(db);
    renderPeek(PLACE.id);
    const region = await screen.findByRole("region", { name: PLACE.title });
    expect(within(region).getByRole("heading", { level: 2, name: PLACE.title })).toBeVisible();
    expect(within(region).getByText("베이커리")).toBeVisible();
  });

  it("shows the road address, else the address, when there is no category", async () => {
    await seed(db);
    await put({ category: null, roadAddress: "제주 도로명 1" });
    renderPeek(PLACE.id);
    expect(await screen.findByText("제주 도로명 1")).toBeVisible();
    expect(screen.queryByText(PLACE.address as string)).toBeNull();
  });

  it("falls back to the address", async () => {
    await seed(db);
    await put({ category: null, roadAddress: null });
    renderPeek(PLACE.id);
    expect(await screen.findByText(PLACE.address as string)).toBeVisible();
  });

  it("opens the details page from the arrow button", async () => {
    await seed(db);
    renderPeek(PLACE.id);
    await userEvent.click(await screen.findByRole("button", { name: en.place.peek.openDetails }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/places/${PLACE.id}/details`);
  });

  it("goes to the details route of an id with a space (the router shows it decoded)", async () => {
    await seed(db);
    await db.places.put({ ...PLACE, id: "p a", title: "슬래시" });
    renderPeek("p a");
    await userEvent.click(await screen.findByRole("button", { name: en.place.peek.openDetails }));
    expect(screen.getByTestId("location")).toHaveTextContent("/places/p a/details");
  });

  it("closes to the map from the X", async () => {
    await seed(db);
    renderPeek(PLACE.id);
    await userEvent.click(await screen.findByRole("button", { name: en.place.peek.close }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("does nothing when the card itself is tapped", async () => {
    await seed(db);
    renderPeek(PLACE.id);
    await userEvent.click(await screen.findByRole("heading", { level: 2, name: PLACE.title }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/places/${PLACE.id}`);
    expect(screen.getByTestId("location").textContent).not.toContain("details");
  });

  it("brings the map to the place, once the place is known", async () => {
    await seed(db);
    renderPeek(PLACE.id);
    await waitFor(() => expect(screen.getByTestId("focus")).toHaveTextContent("33.46,126.31"));
  });

  it("shows the note of a list he owns", async () => {
    await seed(db);
    renderPeek(PLACE.id);
    const note = await screen.findByText("창가 자리");
    expect(note).toHaveClass("mm-place-peek__note");
  });

  it("shows no note element when there is no note", async () => {
    await put({});
    renderPeek(PLACE.id);
    await screen.findByRole("region", { name: PLACE.title });
    expect(document.querySelector(".mm-place-peek__note")).toBeNull();
  });

  it("shows a followed list's note when only that one has a note", async () => {
    await put({});
    await db.lists.bulkPut([list("f1", "followed", "kakao")]);
    await db.user_lists.bulkPut([
      {
        id: "ul_f1",
        listId: "f1",
        role: "follower",
        removedAt: null,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
      },
    ]);
    await db.list_items.put(member("i_f1", "f1", { providerNote: "followed note" }));
    renderPeek(PLACE.id);
    expect(await screen.findByText("followed note")).toBeVisible();
  });

  it("never shows a removed-from-Kakao note, or an own list item's", async () => {
    await put({});
    await db.lists.bulkPut([list("own", "own", null), list("k", "k", "kakao")]);
    await db.list_items.bulkPut([
      member("i_own", "own", { providerNote: "own note" }),
      member("i_k", "k", { providerNote: "gone", removedAtProvider: 5 }),
    ]);
    renderPeek(PLACE.id);
    await screen.findByRole("region", { name: PLACE.title });
    expect(screen.queryByText("own note")).toBeNull();
    expect(screen.queryByText("gone")).toBeNull();
  });

  it("shows the not-found text and Close only for an unknown place", async () => {
    renderPeek("nope");
    expect(await screen.findByText(en.place.notFound)).toBeVisible();
    expect(screen.getByRole("button", { name: en.place.peek.close })).toBeVisible();
    expect(screen.queryByRole("button", { name: en.place.peek.openDetails })).toBeNull();
    expect(screen.getByTestId("focus")).toHaveTextContent("");
  });

  it("shows nothing for a deleted place's card but the not-found text", async () => {
    await put({ deletedAt: 5 });
    renderPeek(PLACE.id);
    expect(await screen.findByText(en.place.notFound)).toBeVisible();
  });

  it("still shows the card, and doesn't move the map, when the place has no coordinates", async () => {
    await put({ lat: null, lng: null });
    renderPeek(PLACE.id);
    expect(await screen.findByRole("heading", { level: 2, name: PLACE.title })).toBeVisible();
    expect(screen.getByRole("button", { name: en.place.peek.openDetails })).toBeVisible();
    expect(screen.getByTestId("focus")).toHaveTextContent("");
  });
});
