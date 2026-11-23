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
    expect(
      await screen.findByText("제주 카페", { selector: ".mm-chip__name" }),
    ).toBeInTheDocument();
    // The same note in two lists shows under each of them.
    expect(screen.getAllByText("창가 자리")).toHaveLength(2);
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

  it("shows each Kakao note under its own list, with no separate section", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const entry = (await screen.findAllByRole("listitem")).find((li) =>
      li.textContent?.includes("제주 카페"),
    );
    expect(entry?.textContent).toContain("창가 자리");
    expect(screen.queryByRole("heading", { level: 3, name: "Kakao notes" })).toBeNull();
    // What a screen reader announces for each note: the list it belongs to.
    expect(screen.getByRole("figure", { name: "Kakao note: 제주 카페" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Kakao note: 가을 산책" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Kakao note: 아내의 맛집" })).toBeInTheDocument();
  });

  it("names a list once: the list's name isn't repeated above its note", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    await screen.findByText("제주 카페", { selector: ".mm-chip__name" });
    expect(screen.getAllByText("제주 카페")).toHaveLength(1);
    expect(screen.getAllByText("가을 산책")).toHaveLength(1);
  });

  it("says 'Change it in Kakao Map' only under notes of lists she owns", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const owned = await screen.findByRole("figure", { name: "Kakao note: 제주 카페" });
    expect(owned.textContent).toContain("Change it in Kakao Map.");
    // 아내의 맛집 is a list she follows: only its owner can change the note.
    const followed = screen.getByRole("figure", { name: "Kakao note: 아내의 맛집" });
    expect(followed.textContent).toContain(LONG_NOTE);
    expect(followed.textContent).not.toContain("Change it in Kakao Map.");
  });

  it("keeps a note from a list removed from Kakao, labelled", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    render(<Memberships placeId={PLACE.id} />);
    const entry = (await screen.findByText(LONG_NOTE)).closest("li");
    expect(entry?.textContent).toContain("Removed from Kakao");
  });

  it("no notes, no note cards", async () => {
    const db = openUserDb(`members${n}`);
    await seed(db);
    await db.list_items.toCollection().modify({ providerNote: null });
    render(<Memberships placeId={PLACE.id} />);
    expect(
      await screen.findByText("제주 카페", { selector: ".mm-chip__name" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("figure")).toHaveLength(0);
  });
});
