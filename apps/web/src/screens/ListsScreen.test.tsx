import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import i18n from "../i18n";
import { MapPrefsProvider } from "../map/mapPrefs";
import { setViewportWidth } from "../test/setup";
import { ListsScreen } from "./ListsScreen";

vi.mock("../map/useMapData", () => ({
  useMapData: () => ({ sections: { mine: [], provider: [], subscribed: [], savedNotInList: 0 } }),
}));

function renderLists(width: number) {
  setViewportWidth(width);
  const { hook } = memoryLocation({ path: "/lists" });
  return render(
    <Router hook={hook}>
      <MapPrefsProvider userId="u1">
        <ListsScreen />
      </MapPrefsProvider>
    </Router>,
  );
}

afterEach(cleanup);

describe("ListsScreen", () => {
  it("shows its title in the page on desktop", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderLists(1440);
    const screenEl = container.querySelector(".mm-screen") as HTMLElement;
    expect(screenEl.querySelector("h1")).toHaveTextContent("Lists");
  });

  it("leaves the title to the header on phones, and keeps New list", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderLists(390);
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByRole("button", { name: "New list" })).toBeInTheDocument();
  });
});
