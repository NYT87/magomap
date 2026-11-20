import type { ListRow } from "@magomap/domain";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ListPicker, type PickerList } from "./ListPicker";

const sync = vi.hoisted(() => ({ syncing: false }));
vi.mock("../data/useSyncStatus", () => ({ useSyncing: () => sync.syncing }));

import { MapPrefsProvider } from "./mapPrefs";

const list = (id: string, provider: string | null): ListRow => ({
  id,
  provider,
  externalId: provider ? id : null,
  name: id,
  description: null,
  color: null,
  ownerName: provider ? "지은" : null,
  removedAtProvider: null,
  providerSnapshotAt: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});
const sections = {
  mine: [{ list: list("빵집", null), count: 2, color: "#1F6F5C" }],
  provider: [{ list: list("카페", "kakao"), count: 3, color: "#c8373e" }],
  subscribed: [{ list: list("아내의 맛집", "kakao"), count: 4, color: "#2464ad" }],
  savedNotInList: 1,
} satisfies Record<string, PickerList[] | number>;

function renderPicker(userId: string) {
  return render(
    <MapPrefsProvider userId={userId}>
      <ListPicker sections={sections} />
    </MapPrefsProvider>,
  );
}

describe("ListPicker", () => {
  it("has the three sections, and hiding Kakao lists keeps my lists on", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    renderPicker("u1");
    const mine = screen.getByRole("group", { name: "My lists" });
    const kakao = screen.getByRole("group", { name: "Kakao lists" });
    expect(screen.getByRole("group", { name: "Subscribed in Kakao" })).toHaveTextContent("지은");
    await user.click(within(kakao).getByRole("button", { name: "Hide all" }));
    expect(within(kakao).getByRole("switch", { name: /카페/ })).not.toBeChecked();
    expect(within(mine).getByRole("switch", { name: /빵집/ })).toBeChecked();
  });

  it("remembers the choices per account", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const first = renderPicker("u2");
    await user.click(screen.getByRole("switch", { name: /빵집/ }));
    await user.click(screen.getByRole("switch", { name: "Show previous locations" }));
    first.unmount();
    renderPicker("u2");
    expect(screen.getByRole("switch", { name: /빵집/ })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Show previous locations" })).not.toBeChecked();
    renderPicker("u3");
    expect(screen.getAllByRole("switch", { name: /빵집/ }).at(-1)).toBeChecked();
  });

  it("opens a list from its row, and its switch only toggles the map", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    window.history.pushState(null, "", "/lists");
    renderPicker("u4");
    expect(screen.getByRole("link", { name: /카페/ })).toHaveAttribute(
      "href",
      "/lists/%EC%B9%B4%ED%8E%98",
    );
    expect(screen.getByRole("link", { name: /Saved, not in a list/ })).toHaveAttribute(
      "href",
      "/lists/__saved",
    );
    await user.click(screen.getByRole("switch", { name: "Show 카페 on the map" }));
    expect(screen.getByRole("switch", { name: "Show 카페 on the map" })).not.toBeChecked();
    expect(window.location.pathname).toBe("/lists");
  });

  it("leaves out a section with nothing in it", async () => {
    await i18n.changeLanguage("en");
    render(
      <MapPrefsProvider userId="u5">
        <ListPicker sections={{ ...sections, mine: [], savedNotInList: 0 }} />
      </MapPrefsProvider>,
    );
    expect(screen.queryByRole("group", { name: "My lists" })).toBeNull();
    expect(screen.getByRole("group", { name: "Kakao lists" })).toBeInTheDocument();
  });

  it("shows the hint when there are no lists at all", async () => {
    await i18n.changeLanguage("en");
    render(
      <MapPrefsProvider userId="u6">
        <ListPicker sections={{ mine: [], provider: [], subscribed: [], savedNotInList: 0 }} />
      </MapPrefsProvider>,
    );
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(screen.getByText(/from kakao-list in Account/)).toBeInTheDocument();
  });

  it("says a Kakao list without places yet is still downloading while a sync runs", async () => {
    await i18n.changeLanguage("en");
    const arriving = {
      ...sections,
      subscribed: [{ list: list("새 리스트", "kakao"), count: 0, color: "#2464ad" }],
    };
    const view = (syncing: boolean) => {
      sync.syncing = syncing;
      return render(
        <MapPrefsProvider userId="u-dl">
          <ListPicker sections={arriving} />
        </MapPrefsProvider>,
      );
    };
    const first = view(true);
    const group = () => screen.getByRole("group", { name: "Subscribed in Kakao" });
    expect(group()).toHaveTextContent("Downloading…");
    expect(group()).not.toHaveTextContent("0 places");
    first.unmount();
    view(false);
    expect(group()).toHaveTextContent("0 places");
    sync.syncing = false;
  });
});
