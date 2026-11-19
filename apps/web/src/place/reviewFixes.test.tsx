// Regression tests for the plan 02 final review (place page and dialogs).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { openUserDb } from "../data/db";
import i18n from "../i18n";
import { NoteEditor } from "./NoteEditor";
import { PLACE } from "./testData";

let n = 0;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
});

describe("note editor", () => {
  it("keeps the draft when the app is hidden right after typing", async () => {
    const db = openUserDb(`ed${n}`);
    render(<NoteEditor placeId={PLACE.id} onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "막 쓴 글" },
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await waitFor(
      async () => expect((await db.drafts.get(`new:${PLACE.id}`))?.body).toBe("막 쓴 글"),
      {
        timeout: 300,
      },
    );
  });

  it("keeps the draft when the editor is closed right after typing", async () => {
    const db = openUserDb(`ed${n}`);
    const view = render(<NoteEditor placeId={PLACE.id} onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "닫기 전" },
    });
    view.unmount();
    await waitFor(
      async () => expect((await db.drafts.get(`new:${PLACE.id}`))?.body).toBe("닫기 전"),
      {
        timeout: 300,
      },
    );
  });

  it("says so when a note can't be saved, and lets her try again", async () => {
    openUserDb(`ed${n}`);
    const user = userEvent.setup();
    render(
      <NoteEditor
        placeId={PLACE.id}
        note={{ id: "missing", visitedOn: null, body: "x" }}
        onDone={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled();
  });

  it("takes focus when it opens", () => {
    openUserDb(`ed${n}`);
    render(<NoteEditor placeId={PLACE.id} onDone={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
  });
});

/** A page with a dialog open over it, and a button that re-renders the page. */
function Host() {
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setTick((t) => t + 1)}>
        tick {tick}
      </button>
      <ConfirmDialog title="t" role="dialog" onCancel={() => {}}>
        <button type="button">first</button>
        <input aria-label="name" />
      </ConfirmDialog>
    </>
  );
}

describe("dialogs", () => {
  it("keeps focus where she's typing when the page behind re-renders", async () => {
    render(<Host />);
    const input = screen.getByRole("textbox", { name: "name" });
    input.focus();
    act(() => {
      (document.querySelector("button") as HTMLButtonElement).click();
    });
    expect(input).toHaveFocus();
  });
});
