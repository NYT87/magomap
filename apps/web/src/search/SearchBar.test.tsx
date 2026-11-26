// The search bar's Save on a Kakao result opens the map's "Save to…" with that place (#search).
import type { SearchResult } from "@magomap/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { MapStageProvider, useMapStage } from "../map/MapStage";

const result: SearchResult = {
  provider: "kakao",
  externalId: "123",
  title: "바다빵집",
  address: "제주 애월읍",
  roadAddress: null,
  category: "베이커리",
  phone: null,
  lat: 33.46,
  lng: 126.31,
  signedAt: 1,
  signature: "sig",
};
// One state object, as the real hook keeps it between renders (a new one each render would
// re-run the bar's effects for ever).
const state = { mode: "kakao", results: [{ kind: "kakao", result }], loading: false };
vi.mock("./useSearch", () => ({
  useSearch: () => state,
  openSearchHit: async () => null,
}));
const savePlaceFromSearch = vi.fn(async () => "p_kakao_123");
vi.mock("../data/writes", () => ({ savePlaceFromSearch: () => savePlaceFromSearch() }));
const { SearchBar } = await import("./SearchBar");

const saveFound = vi.fn();
/** Stands in for the map: it opens its save menu for a found place. */
function MapOpensMenu({ present }: { present: boolean }) {
  const stage = useMapStage();
  useEffect(() => {
    stage.saveFound.current = present ? saveFound : null;
  }, [stage, present]);
  return null;
}

function renderBar(map: boolean) {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <MapStageProvider>
        <MapOpensMenu present={map} />
        <SearchBar />
      </MapStageProvider>
    </Router>,
  );
}

let n = 0;
beforeEach(async () => {
  n += 1;
  openUserDb(`search-bar${n}`);
  await i18n.changeLanguage("en");
  saveFound.mockReset();
  savePlaceFromSearch.mockClear();
});

describe("SearchBar", () => {
  it("says it searches Kakao places as well as her own", () => {
    renderBar(true);
    expect(screen.getByPlaceholderText(/Kakao/)).toBeInTheDocument();
  });

  it("Save on a Kakao result opens the map's Save to… with that place, saving nothing yet", async () => {
    renderBar(true);
    await userEvent.type(screen.getByRole("searchbox"), "빵");
    await userEvent.click(await screen.findByRole("button", { name: "Save to…" }));
    expect(saveFound).toHaveBeenCalledWith(
      { result, distanceM: 0 },
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
    expect(savePlaceFromSearch).not.toHaveBeenCalled();
  });

  it("without a map to open it on, Save still saves the place, as before", async () => {
    renderBar(false);
    await userEvent.type(screen.getByRole("searchbox"), "빵");
    await userEvent.click(await screen.findByRole("button", { name: "Save to…" }));
    expect(savePlaceFromSearch).toHaveBeenCalledOnce();
  });
});
