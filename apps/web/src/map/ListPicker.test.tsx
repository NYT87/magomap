import type { ListRow } from "@magomap/domain";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { ListPicker, type PickerList } from "./ListPicker";
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
});
