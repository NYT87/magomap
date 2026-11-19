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

  it("never writes one place's draft over another's when the place changes under it", async () => {
    const db = openUserDb(`ed${n}`);
    await db.drafts.put({
      key: "new:p_kakao_other",
      visitedOn: null,
      body: "B의 초안",
      updatedAt: 1,
    });
    const view = render(<NoteEditor placeId={PLACE.id} onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "A에 쓴 글" },
    });
    view.rerender(<NoteEditor placeId="p_kakao_other" onDone={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("B의 초안"),
    );
    await new Promise((r) => setTimeout(r, 600));
    expect((await db.drafts.get(`new:${PLACE.id}`))?.body).toBe("A에 쓴 글");
    expect((await db.drafts.get("new:p_kakao_other"))?.body).toBe("B의 초안");
  });

  it("keeps a draft in its own account's database when another account opens", async () => {
    const a = openUserDb(`ed-a${n}`);
    const view = render(<NoteEditor placeId={PLACE.id} onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "A의 비밀" },
    });
    const b = openUserDb(`ed-b${n}`);
    view.unmount();
    await waitFor(async () =>
      expect((await a.drafts.get(`new:${PLACE.id}`))?.body).toBe("A의 비밀"),
    );
    expect(await b.drafts.count()).toBe(0);
  });

  it("closes quietly when its database was deleted from another tab", async () => {
    const db = openUserDb(`ed-x${n}`);
    const view = render(<NoteEditor placeId={PLACE.id} onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "늦은 글" },
    });
    db.close({ disableAutoOpen: true });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    window.addEventListener("unhandledrejection", onUnhandled);
    process.on("unhandledRejection", onUnhandled as never);
    view.unmount();
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener("unhandledrejection", onUnhandled);
    process.off("unhandledRejection", onUnhandled as never);
    expect(unhandled).toEqual([]);
  });

  it("leaves an undated note undated when only its text changes", () => {
    openUserDb(`ed${n}`);
    render(
      <NoteEditor
        placeId={PLACE.id}
        note={{ id: "n1", visitedOn: null, body: "옛 기록" }}
        onDone={() => {}}
      />,
    );
    expect(screen.getByLabelText(/date/i)).toHaveValue("");
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
