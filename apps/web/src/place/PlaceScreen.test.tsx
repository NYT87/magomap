import { render, screen } from "@testing-library/react";
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
});
