import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { PLACE, seed } from "./testData";

const detect = vi.fn<() => Promise<"ready" | "missing">>();
vi.mock("../import/kakaoMap", () => ({ detectExtension: () => detect() }));
const setNote = vi.fn();
vi.mock("./setKakaoNote", () => {
  class NoteError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  class NoteChangedError extends NoteError {
    constructor(readonly current: string) {
      super("note_changed");
    }
  }
  return { NoteChangedError, NoteError, setKakaoNote: (i: unknown) => setNote(i) };
});
const { Memberships } = await import("./Memberships");
const { NoteChangedError, NoteError } = await import("./setKakaoNote");

let n = 0;
beforeEach(async () => {
  n += 1;
  detect.mockReset();
  detect.mockResolvedValue("ready");
  setNote.mockReset();
  setNote.mockResolvedValue(undefined);
  await i18n.changeLanguage("en");
});

async function open() {
  const db = openUserDb(`mnote${n}`);
  await seed(db);
  render(<Memberships placeId={PLACE.id} />);
  await screen.findByText("제주 카페", { selector: ".mm-chip__name" });
  return db;
}
const edit = (list: string) => screen.queryByRole("button", { name: `Edit Kakao note in ${list}` });

describe("Memberships: editing a Kakao note", () => {
  it("is offered on the notes of Kakao lists he owns, never on one he follows", async () => {
    await open();
    expect(
      await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }),
    ).toBeEnabled();
    expect(edit("가을 산책")).toBeEnabled();
    expect(edit("아내의 맛집")).toBeNull();
    expect(edit("빵 지도")).toBeNull();
  });

  it("offers adding a note on an owned Kakao list that has none", async () => {
    const db = openUserDb(`mnote${n}`);
    await seed(db);
    await db.list_items.update("i_kakao_1_10", { providerNote: null });
    render(<Memberships placeId={PLACE.id} />);
    expect(
      await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }),
    ).toBeEnabled();
  });

  it("stays read-only with a line when the extension doesn't answer", async () => {
    detect.mockResolvedValue("missing");
    await open();
    await waitFor(() => expect(edit("제주 카페")).toBeNull());
    expect(screen.getAllByText(/magomap extension/i).length).toBeGreaterThan(0);
  });

  it("opens a labelled box with the current note, and Save sends the text", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    const box = screen.getByRole("textbox", { name: "Kakao note in 제주 카페" });
    expect(box).toHaveValue("창가 자리");
    expect(box).toHaveFocus();
    await user.clear(box);
    await user.type(box, "새 메모");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(setNote).toHaveBeenCalledWith({ itemId: "i_kakao_1_10", note: "새 메모" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("can save an empty note, which clears it", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    await user.clear(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(setNote).toHaveBeenCalledWith({ itemId: "i_kakao_1_10", note: "" });
  });

  it("puts focus back on the Edit button after saving and after cancelling", async () => {
    const user = userEvent.setup();
    await open();
    const trigger = await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Save" }));
    // The button comes back as a new element: look it up again.
    const again = () => screen.getByRole("button", { name: "Edit Kakao note in 제주 카페" });
    await waitFor(() => expect(again()).toHaveFocus());
    await user.click(again());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(again()).toHaveFocus());
    expect(setNote).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels without saving; Enter in the box adds a line, it doesn't save", async () => {
    const user = userEvent.setup();
    await open();
    const trigger = await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" });
    await user.click(trigger);
    const box = screen.getByRole("textbox", { name: "Kakao note in 제주 카페" });
    await user.type(box, "{Enter}둘째");
    expect(setNote).not.toHaveBeenCalled();
    expect(box).toHaveValue("창가 자리\n둘째");
    await user.keyboard("{Escape}");
    expect(setNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Kakao note in 제주 카페" })).toHaveFocus(),
    );
  });

  it("shows why it failed and keeps what was typed", async () => {
    setNote.mockRejectedValue(new NoteError("account_mismatch"));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    await user.type(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/different Kakao Map account/i);
    expect(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" })).toHaveValue(
      "창가 자리!",
    );
  });

  it("warns when the note was changed in Kakao Map, showing the new note, and overwrites only after confirming", async () => {
    setNote.mockRejectedValueOnce(new NoteChangedError("아내가 바꾼 메모"));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    await user.type(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const warning = await screen.findByRole("alertdialog");
    expect(warning).toHaveTextContent(/changed in Kakao Map since your last sync/i);
    expect(warning).toHaveTextContent("아내가 바꾼 메모");
    expect(warning).toHaveTextContent(/overwrite/i);
    // Nothing was overwritten yet, and what he typed is kept.
    expect(setNote).toHaveBeenCalledTimes(1);
    expect(setNote.mock.calls[0]?.[0]).not.toHaveProperty("overwrite");
    await user.click(screen.getByRole("button", { name: "Overwrite the updated note" }));
    await waitFor(() => expect(setNote).toHaveBeenCalledTimes(2));
    expect(setNote.mock.calls[1]?.[0]).toEqual({
      itemId: "i_kakao_1_10",
      note: "창가 자리!",
      overwrite: true,
    });
  });

  it("goes back to editing, with his text kept, when he doesn't overwrite", async () => {
    setNote.mockRejectedValueOnce(new NoteChangedError("아내가 바꾼 메모"));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    await user.type(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" })).toHaveValue(
      "창가 자리!",
    );
    expect(setNote).toHaveBeenCalledTimes(1);
  });

  it("says Kakao Map has the note when only magomap's own save failed", async () => {
    setNote.mockRejectedValue(new NoteError("server_failed"));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Kakao Map has the new note/i);
  });

  it("keeps the box limited to the note limit", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: "Edit Kakao note in 제주 카페" }));
    expect(screen.getByRole("textbox", { name: "Kakao note in 제주 카페" })).toHaveAttribute(
      "maxlength",
      "5000",
    );
  });
});
