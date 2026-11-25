import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import i18n from "../i18n";
import { MapStageProvider, useMapStage } from "../map/MapStage";
import { setViewportWidth } from "../test/setup";

// The map itself and what reads the library are stand-ins: this is about the buttons.
vi.mock("../map/MapView", () => ({ MapView: () => null }));
vi.mock("../map/useMapData", () => ({ useMapData: () => null }));
vi.mock("../search/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("../components/SyncIndicator", () => ({ SyncIndicator: () => null }));
vi.mock("../layout/AppLayout", () => ({ NoticeSlot: () => null }));

const { MapScreen } = await import("./MapScreen");

const saveHere = vi.fn();
/** Stands in for the map's own "open the save menu at the centre". */
function MapOpensMenu() {
  const stage = useMapStage();
  useEffect(() => {
    stage.saveHere.current = saveHere;
  }, [stage]);
  return null;
}

function renderAt(width: number, path = "/") {
  setViewportWidth(width);
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <MapStageProvider>
        <MapOpensMenu />
        <MapScreen />
      </MapStageProvider>
    </Router>,
  );
}

afterEach(() => {
  setViewportWidth(390);
  saveHere.mockReset();
});

describe("MapScreen", () => {
  it("has a Save a place here button among the phone map's buttons, opening the menu at the centre", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderAt(390);
    const button = screen.getByRole("button", { name: "Save a place here" });
    expect(button).toHaveClass("mm-fab");
    expect(container.querySelector(".mm-map-tools")).toContainElement(button);
    await userEvent.click(button);
    expect(saveHere).toHaveBeenCalledOnce();
  });

  it("names it in Korean", async () => {
    await i18n.changeLanguage("ko");
    renderAt(390);
    expect(screen.getByRole("button", { name: "이 위치에서 장소 저장" })).toBeVisible();
    await i18n.changeLanguage("en");
  });

  it("has no such button on a desktop", async () => {
    await i18n.changeLanguage("en");
    renderAt(1440);
    expect(screen.queryByRole("button", { name: "Save a place here" })).toBeNull();
  });
});
