import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { Diary } from "./Diary";
import { MovedNote } from "./MovedNote";
import { OLD_LOCATION, PLACE } from "./testData";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let n = 0;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
});

describe("Diary", () => {
  it("saves a new note dated today, in local time", async () => {
    const db = openUserDb(`diary${n}`);
    await db.places.put(PLACE);
    const user = userEvent.setup();
    render(<Diary placeId={PLACE.id} />);
    await user.click(await screen.findByRole("button", { name: "Add visit note" }));
    await user.type(
      screen.getByRole("textbox", { name: "Note" }),
      "창가 자리에서 바다가 보였어요.",
    );
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(async () => expect(await db.visit_notes.count()).toBe(1));
    const [saved] = await db.visit_notes.toArray();
    expect(saved?.visitedOn).toBe(localToday());
    expect(await screen.findByText("창가 자리에서 바다가 보였어요.")).toBeInTheDocument();
  });

  it("keeps an unsaved draft when the editor closes and reopens", async () => {
    const db = openUserDb(`diary${n}`);
    await db.places.put(PLACE);
    const user = userEvent.setup();
    const first = render(<Diary placeId={PLACE.id} />);
    await user.click(await screen.findByRole("button", { name: "Add visit note" }));
    await user.type(screen.getByRole("textbox", { name: "Note" }), "반쯤 쓴 메모");
    await waitFor(
      async () => expect((await db.drafts.get(`new:${PLACE.id}`))?.body).toBe("반쯤 쓴 메모"),
      {
        timeout: 3_000,
      },
    );
    first.unmount();
    render(<Diary placeId={PLACE.id} />);
    await user.click(await screen.findByRole("button", { name: "Add visit note" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("반쯤 쓴 메모"),
    );
  });

  it("labels notes written at the previous location", async () => {
    const db = openUserDb(`diary${n}`);
    await db.places.put(PLACE);
    await db.place_locations.put(OLD_LOCATION);
    const note = (id: string, visitedOn: string, body: string) => ({
      id,
      placeId: PLACE.id,
      visitedOn,
      body,
      origin: "user" as const,
      originKey: null,
      editedByUser: false,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await db.visit_notes.bulkPut([
      note("before", "2026-03-10", "before the move"),
      note("after", "2026-08-10", "after the move"),
    ]);
    render(
      <>
        <MovedNote placeId={PLACE.id} />
        <Diary placeId={PLACE.id} />
      </>,
    );
    expect(await screen.findByRole("button", { name: /Moved/ })).toBeInTheDocument();
    const before = (await screen.findByText("before the move")).closest("article") as HTMLElement;
    const after = (await screen.findByText("after the move")).closest("article") as HTMLElement;
    expect(within(before).getByText(/at 제주 애월읍 옛 주소/)).toBeInTheDocument();
    expect(within(after).queryByText(/at 제주/)).toBeNull();
  });
});
