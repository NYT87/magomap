import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { Memberships } from "./Memberships";
import { PLACE, seed } from "./testData";

let n = 0;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
});

describe("Memberships", () => {
  it("lets own-list chips be removed, but never Kakao ones", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    const user = userEvent.setup();
    render(<Memberships placeId={PLACE.id} />);
    expect(await screen.findByText("제주 카페")).toBeInTheDocument();
    expect(screen.getByText("창가 자리")).toBeInTheDocument();
    expect(screen.getByText("Removed from Kakao")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove from 제주 카페/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove from 아내의 맛집/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove from 빵 지도" }));
    await waitFor(async () =>
      expect((await db.list_items.get("li_own-a"))?.deletedAt).not.toBeNull(),
    );
  });

  it("offers only own lists to add the place to", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const select = await screen.findByRole("combobox", { name: "Add to list" });
    const options = [...(select as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toContain("가 볼 곳");
    expect(options).not.toContain("빵 지도");
    expect(options).not.toContain("제주 카페");
    expect(options).not.toContain("아내의 맛집");
  });
});
