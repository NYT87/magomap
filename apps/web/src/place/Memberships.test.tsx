import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { Memberships } from "./Memberships";
import { LONG_NOTE, PLACE, seed } from "./testData";

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
    // The list's chip (its name also appears on the Kakao note card it's attributed to).
    expect(
      await screen.findByText("제주 카페", { selector: ".mm-chip__name" }),
    ).toBeInTheDocument();
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

  it("shows Kakao notes apart from the chips", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const chip = (await screen.findAllByRole("listitem")).find((li) =>
      li.textContent?.includes("제주 카페"),
    );
    expect(chip).toBeDefined();
    expect(chip?.textContent).not.toContain("창가 자리");
    expect(screen.getByRole("heading", { level: 3, name: "Kakao notes" })).toBeInTheDocument();
    // What a screen reader announces for each note: every list it comes from.
    expect(
      screen.getByRole("figure", { name: "Kakao note: 제주 카페 · 가을 산책" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("figure", { name: "Kakao note: 아내의 맛집 (Removed from Kakao)" }),
    ).toBeInTheDocument();
    const notes = screen.getAllByText("창가 자리");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.closest("[aria-label]")?.getAttribute("aria-label")).toMatch(/^Kakao note/);
    expect(screen.getAllByText("Change it in Kakao Map.").length).toBeGreaterThan(0);
  });

  it("names every list a shared note comes from", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const card = (await screen.findByText("창가 자리")).closest("figure");
    expect(card?.querySelector("figcaption")?.textContent).toContain("제주 카페");
    expect(card?.querySelector("figcaption")?.textContent).toContain("가을 산책");
  });

  it("keeps a note from a list removed from Kakao, labelled", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const card = (await screen.findByText(LONG_NOTE)).closest("figure");
    expect(card?.querySelector("figcaption")?.textContent).toContain("(Removed from Kakao)");
  });

  it("no notes, no heading", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    await db.list_items.toCollection().modify({ providerNote: null });
    render(<Memberships placeId={PLACE.id} />);
    expect(
      await screen.findByText("제주 카페", { selector: ".mm-chip__name" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kakao notes" })).toBeNull();
  });
});
