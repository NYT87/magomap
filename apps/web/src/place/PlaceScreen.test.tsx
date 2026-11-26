import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import en from "../i18n/en.json";
import { MapStageProvider } from "../map/MapStage";
import { PlaceScreen } from "./PlaceScreen";
import { PLACE, seed } from "./testData";

let n = 0;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
});

describe("PlaceScreen", () => {
  it("names the place in the window title, and no longer an old one when it isn't found", async () => {
    const db = openUserDb(`place-screen-title${n}`);
    await seed(db);
    const view = render(
      <MapStageProvider>
        <PlaceScreen id={PLACE.id} />
      </MapStageProvider>,
    );
    await waitFor(() => expect(document.title).toBe(`${PLACE.title} – magomap`));
    view.unmount();
    render(
      <MapStageProvider>
        <PlaceScreen id="p_kakao_missing" />
      </MapStageProvider>,
    );
    await screen.findByText(en.place.notFound);
    await waitFor(() => expect(document.title).toBe("magomap"));
  });

  it("lists come before the diary and links", async () => {
    const db = openUserDb(`place-screen${n}`);
    await seed(db);
    render(
      <MapStageProvider>
        <PlaceScreen id={PLACE.id} />
      </MapStageProvider>,
    );
    await screen.findByRole("heading", { level: 2, name: en.place.lists });
    await screen.findByRole("heading", { level: 2, name: en.place.diary });
    await screen.findByRole("heading", { level: 2, name: en.place.links });
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order).toEqual([en.place.lists, en.place.diary, en.place.links]);
  });

  it("opens Kakao Map from an icon in the header's corner, not a text button", async () => {
    const db = openUserDb(`place-screen${n}`);
    await seed(db);
    await db.place_sources.put({
      id: "s_kakao_27324155",
      placeId: PLACE.id,
      provider: "kakao",
      externalId: "27324155",
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
    });
    render(
      <MapStageProvider>
        <PlaceScreen id={PLACE.id} />
      </MapStageProvider>,
    );
    const link = await screen.findByRole("link", { name: en.place.openKakao });
    expect(link.textContent).toBe("");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.classList.contains("mm-place__kakao")).toBe(true);
    expect(link.closest("header")).not.toBeNull();
    expect(link).toHaveAttribute("title", en.place.openKakao);
  });
});
