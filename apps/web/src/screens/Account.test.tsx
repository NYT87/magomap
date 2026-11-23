import type { Me } from "@magomap/domain";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { NetworkError } from "../api/client";
import { SyncContext, type SyncControls } from "../data/SyncContext";
import i18n from "../i18n";
import { MapPrefsProvider } from "../map/mapPrefs";
import { setViewportWidth } from "../test/setup";
import { Account } from "./Account";

const { closeUserDb, openDbOrNull, openUserDb } = await import("../data/db");

vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: vi.fn(async () => ({})) };
});
const { apiFetch } = await import("../api/client");

/** Answers one API path once with `answer`; every other call gets the default empty reply. */
function answerOnce(path: string, answer: () => Promise<unknown>) {
  let used = false;
  vi.mocked(apiFetch).mockImplementation(async (p: string) => {
    if (p === path && !used) {
      used = true;
      return answer();
    }
    return {};
  });
}

beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (p: string) =>
    p === "/api/import/status"
      ? { latest: null, sourceSnapshotAt: null, upToDate: false, source: "ok" }
      : {},
  );
});

const me = { userId: "u1", displayName: "지은", identities: [{ provider: "kakao" as const }] };

function renderAccount(sync: Partial<SyncControls> = {}, who: Me = me) {
  const controls: SyncControls = {
    unsynced: 0,
    rejected: 0,
    syncNow: vi.fn(async () => {}),
    ...sync,
  };
  render(
    <MapPrefsProvider userId={who.userId}>
      <SyncContext.Provider value={controls}>
        <Account me={who} />
      </SyncContext.Provider>
    </MapPrefsProvider>,
  );
  return controls;
}

async function makeDb() {
  const db = new Dexie("magomap-u1");
  db.version(1).stores({ outbox: "++seq" });
  await db.open();
  await db.table("outbox").add({ id: "x" });
  db.close();
}

describe("Account", () => {
  it("shows its title in the page on desktop, and leaves it to the header on phones", async () => {
    await i18n.changeLanguage("en");
    setViewportWidth(1440);
    renderAccount();
    expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    cleanup();
    setViewportWidth(390);
    renderAccount();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("downloads the account's data for this account, and says when it fails", async () => {
    await i18n.changeLanguage("en");
    let exports = 0;
    const fetchMock = vi.fn(async (path: string) =>
      path === "/api/me/export"
        ? new Response("{}", { status: ++exports === 1 ? 200 : 500 })
        : new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const createUrl = vi.fn(() => "blob:x");
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    renderAccount();
    const button = screen.getByRole("button", { name: "Download my data" });
    await user.click(button);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/me/export", {
      credentials: "same-origin",
      headers: { "x-magomap-user": "u1" },
    });
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("The download didn’t work");
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("deletes the account only after the shown word is typed", async () => {
    await i18n.changeLanguage("en");
    await makeDb();
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "delete");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/account", {
        method: "DELETE",
        headers: { "x-magomap-user": "u1" },
      }),
    );
    await waitFor(async () => expect(await Dexie.exists("magomap-u1")).toBe(false));
  });

  it("warns before signing out with unsynced changes, and keeps them", async () => {
    await i18n.changeLanguage("en");
    await makeDb();
    const user = userEvent.setup();
    const sync = renderAccount({
      unsynced: 2,
      syncNow: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(sync.syncNow).toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Sign out anyway" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
        headers: { "x-magomap-user": "u1" },
      }),
    );
    expect(await Dexie.exists("magomap-u1")).toBe(true);
  });

  it("also mentions changes the server couldn't save", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    renderAccount({ unsynced: 0, rejected: 1, syncNow: vi.fn(async () => {}) });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("couldn't be saved on the server");
  });

  it("says plainly that signing out needs a connection", async () => {
    await i18n.changeLanguage("en");
    answerOnce("/api/auth/logout", () => Promise.reject(new NetworkError()));
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("once you're online");
  });

  it("warns that unsent changes are lost when deleting the account", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    renderAccount({ unsynced: 3 });
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("3 changes on this phone");
  });

  it("signs out everywhere only for the account it shows", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole("button", { name: "Sign out on every device" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/auth/logout-all", {
        method: "POST",
        headers: { "x-magomap-user": "u1" },
      }),
    );
  });

  it("leaves another account that opened meanwhile alone when the delete finishes", async () => {
    await i18n.changeLanguage("en");
    openUserDb("u1");
    let answer: (v: unknown) => void = () => {};
    answerOnce(
      "/api/account",
      () =>
        new Promise((r) => {
          answer = r;
        }),
    );
    window.history.pushState(null, "", "/account");
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByRole("textbox"), "delete");
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    const other = openUserDb("u2");
    answer({});
    await waitFor(async () => expect(await Dexie.exists("magomap-u1")).toBe(false));
    expect(openDbOrNull()).toBe(other);
    expect(window.location.pathname).toBe("/account");
  });

  it("leaves an account that opened while the database was being deleted alone", async () => {
    await i18n.changeLanguage("en");
    openUserDb("u1");
    const realDelete = Dexie.delete.bind(Dexie);
    let other: unknown = null;
    const spy = vi.spyOn(Dexie, "delete").mockImplementation(async (name: string) => {
      other = openUserDb("u3");
      await realDelete(name);
    });
    window.history.pushState(null, "", "/account");
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByRole("textbox"), "delete");
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(async () => expect(await Dexie.exists("magomap-u1")).toBe(false));
    await new Promise((r) => setTimeout(r, 20));
    spy.mockRestore();
    expect(openDbOrNull()).toBe(other);
    expect(window.location.pathname).toBe("/account");
  });

  it("still offers to sign out when unsent changes can't be counted", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    renderAccount({
      unsynced: 2,
      syncNow: vi.fn(async () => {}),
      countUnsynced: vi.fn(async () => {
        throw new Error("closed");
      }),
    });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("2");
  });

  it("finishes signing out when the account's database was replaced meanwhile", async () => {
    await i18n.changeLanguage("en");
    openUserDb("u1");
    let answer: (v: unknown) => void = () => {};
    answerOnce(
      "/api/auth/logout",
      () =>
        new Promise((r) => {
          answer = r;
        }),
    );
    window.history.pushState(null, "", "/account");
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    // Another tab deleted this account's local data; a fresh database opened for the same account.
    closeUserDb();
    openUserDb("u1");
    answer({});
    await waitFor(() => expect(window.location.pathname).toBe("/signin"));
  });

  it("offers importing from kakao-list", async () => {
    await i18n.changeLanguage("en");
    renderAccount();
    expect(
      screen.getByRole("heading", { level: 2, name: "Import from kakao-list" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import from kakao-list" })).toBeInTheDocument();
  });

  it("shows who is signed in, without sign-in or Google notes", async () => {
    await i18n.changeLanguage("en");
    renderAccount();
    expect(screen.getByRole("heading", { level: 2, name: "지은" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in|Kakao login|Google/)).toBeNull();
  });

  it("names the Kakao account when Kakao gave no name", async () => {
    await i18n.changeLanguage("en");
    renderAccount({}, { ...me, displayName: null });
    expect(screen.getByRole("heading", { level: 2, name: "Kakao account" })).toBeInTheDocument();
  });

  it("shows every account action as an outlined button", async () => {
    await i18n.changeLanguage("en");
    renderAccount();
    for (const name of ["Sign out", "Sign out on every device", "Delete account"]) {
      const b = screen.getByRole("button", { name });
      expect(b.className).toMatch(/mm-button--(secondary|danger-outline)/);
      expect(b.className).not.toMatch(/tertiary|danger-text/);
    }
  });

  it("offers the map choice, Automatic by default, and remembers it", async () => {
    await i18n.changeLanguage("en");
    localStorage.removeItem("mm.mapProvider.u1");
    const user = userEvent.setup();
    renderAccount();
    const map = screen.getByRole("combobox", { name: "Map" });
    expect(map).toHaveValue("auto");
    expect(
      screen.getByText("Automatic uses Kakao Map in Korea and OpenStreetMap elsewhere."),
    ).toBeInTheDocument();
    await user.selectOptions(map, "osm");
    cleanup();
    renderAccount();
    expect(screen.getByRole("combobox", { name: "Map" })).toHaveValue("osm");
  });

  describe("nickname", () => {
    const setOnline = (on: boolean) =>
      Object.defineProperty(navigator, "onLine", { value: on, configurable: true });

    it("edits the nickname", async () => {
      await i18n.changeLanguage("en");
      setOnline(true);
      const user = userEvent.setup();
      renderAccount();
      await user.click(screen.getByRole("button", { name: "Edit name" }));
      const field = screen.getByRole("textbox", { name: "Nickname" });
      expect(field).toHaveValue("지은");
      await user.clear(field);
      await user.type(field, "민수");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith(
          "/api/me",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ displayName: "민수" }),
          }),
        ),
      );
      await waitFor(() => expect(screen.queryByRole("textbox", { name: "Nickname" })).toBeNull());
    });

    it("Cancel keeps the name", async () => {
      await i18n.changeLanguage("en");
      setOnline(true);
      const user = userEvent.setup();
      renderAccount();
      await user.click(screen.getByRole("button", { name: "Edit name" }));
      await user.type(screen.getByRole("textbox", { name: "Nickname" }), "x");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("textbox", { name: "Nickname" })).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "지은" })).toBeInTheDocument();
      expect(apiFetch).not.toHaveBeenCalledWith("/api/me", expect.anything());
    });

    it("counts the nickname's limit in characters, emoji included", async () => {
      await i18n.changeLanguage("en");
      setOnline(true);
      const user = userEvent.setup();
      renderAccount();
      await user.click(screen.getByRole("button", { name: "Edit name" }));
      const field = screen.getByRole("textbox", { name: "Nickname" });
      await user.clear(field);
      await user.type(field, "🌸".repeat(41));
      // Not cut while typing (Korean input), but Save waits until it fits, and says why.
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(field).toHaveAccessibleDescription("Up to 40 characters.");
      await user.type(field, "{Enter}");
      expect(apiFetch).not.toHaveBeenCalledWith("/api/me", expect.anything());
      await user.type(field, "{Backspace}{Backspace}");
      expect(Array.from((field as HTMLInputElement).value)).toHaveLength(40);
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("gives focus back to Edit name when the editor closes", async () => {
      await i18n.changeLanguage("en");
      setOnline(true);
      const user = userEvent.setup();
      renderAccount();
      await user.click(screen.getByRole("button", { name: "Edit name" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Edit name" })).toHaveFocus();
    });

    it("Edit is off offline", async () => {
      await i18n.changeLanguage("en");
      setOnline(false);
      try {
        renderAccount();
        expect(screen.getByRole("button", { name: "Edit name" })).toBeDisabled();
      } finally {
        setOnline(true);
      }
    });

    it("says so when the name can't be saved", async () => {
      await i18n.changeLanguage("en");
      setOnline(true);
      answerOnce("/api/me", () => Promise.reject(new NetworkError()));
      const user = userEvent.setup();
      renderAccount();
      await user.click(screen.getByRole("button", { name: "Edit name" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't reach the server/);
      expect(screen.getByRole("textbox", { name: "Nickname" })).toBeInTheDocument();
    });
  });

  describe("remove my data from this device", () => {
    const keys = ["mm.visibleLists.u1", "mm.showPrevious.u1", "mm.mapProvider.u1", "mm.name.u1"];
    const draft = { key: "new:p", visitedOn: null, body: "비밀 메모", updatedAt: 1 };
    /** The account's database on this device, with a draft, and queues as given. */
    const seedDevice = async (rows: { outbox?: number; rejected?: number } = {}) => {
      // A fresh database each time: earlier tests leave queued and refused changes behind.
      closeUserDb("u1");
      await Dexie.delete("magomap-u1");
      const db = openUserDb("u1");
      await db.drafts.put(draft);
      for (let i = 0; i < (rows.outbox ?? 0); i++) {
        await db.outbox.add({
          mutationId: `m${i}`,
          table: "visit_notes",
          id: `n${i}`,
          op: "delete",
          clientUpdatedAt: 1,
        });
      }
      for (let i = 0; i < (rows.rejected ?? 0); i++) {
        await db.rejected.put({
          mutationId: `r${i}`,
          table: "visit_notes",
          id: `n${i}`,
          op: "delete",
          reason: "invalid",
          at: 1,
        });
      }
      for (const k of keys) localStorage.setItem(k, "x");
      localStorage.setItem("mm.lang", "en");
    };
    const leftOnDevice = () => keys.filter((k) => localStorage.getItem(k) !== null);
    const draftsLeft = async () => {
      const db = openUserDb("u1");
      const n = await db.drafts.count();
      closeUserDb("u1");
      return n;
    };
    const check = () =>
      screen.getByRole("checkbox", { name: "Also remove my data from this device" });

    it("removes this account's data from the device when asked", async () => {
      await i18n.changeLanguage("en");
      await seedDevice();
      window.history.pushState(null, "", "/account");
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(window.location.pathname).toBe("/signin"));
      expect(await draftsLeft()).toBe(0);
      expect(leftOnDevice()).toEqual([]);
      expect(localStorage.getItem("mm.lang")).toBe("en");
      expect(sessionStorage.getItem("mm.removeResult")).toBe("removed");
    });

    it('keeps the data when changes are unsynced, even after "Sign out anyway"', async () => {
      await i18n.changeLanguage("en");
      await seedDevice({ outbox: 2 });
      const user = userEvent.setup();
      renderAccount({ unsynced: 2, syncNow: vi.fn(async () => {}) });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(
        "Your unsynced changes will stay on this device, so its data won't be removed.",
      );
      await user.click(screen.getByRole("button", { name: "Sign out anyway" }));
      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith("/api/auth/logout", expect.anything()),
      );
      expect(await draftsLeft()).toBe(1);
      expect(leftOnDevice()).toEqual(keys);
    });

    it("keeps the data when sign-out's own sync leaves a refused change", async () => {
      await i18n.changeLanguage("en");
      // The note was pending; the sync refused it, so it moved to "couldn't be saved".
      await seedDevice({ rejected: 1 });
      window.history.pushState(null, "", "/account");
      const user = userEvent.setup();
      renderAccount({
        unsynced: 1,
        rejected: 0,
        syncNow: vi.fn(async () => {}),
        countUnsynced: vi.fn(async () => 0),
      });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(window.location.pathname).toBe("/signin"));
      expect(await draftsLeft()).toBe(1);
      expect(leftOnDevice()).toEqual(keys);
      expect(sessionStorage.getItem("mm.removeResult")).toBe("kept");
    });

    it("keeps the data by default", async () => {
      await i18n.changeLanguage("en");
      await seedDevice();
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      expect(check()).not.toBeChecked();
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() =>
        expect(apiFetch).toHaveBeenCalledWith("/api/auth/logout", expect.anything()),
      );
      expect(await draftsLeft()).toBe(1);
    });

    it("signs out and removes the data even while another tab has the database open", async () => {
      await i18n.changeLanguage("en");
      await seedDevice();
      // Another tab's connection: removing the data mustn't wait for it to go away.
      const held = await new Promise<IDBDatabase>((ok) => {
        const r = indexedDB.open("magomap-u1");
        r.onsuccess = () => ok(r.result);
      });
      window.history.pushState(null, "", "/account");
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(window.location.pathname).toBe("/signin"));
      expect(await draftsLeft()).toBe(0);
      held.close();
    });

    it("never waits for long on a database another tab holds at an older version", async () => {
      await i18n.changeLanguage("en");
      closeUserDb("u1");
      await Dexie.delete("magomap-u1");
      // An older version of the database, held open by a connection that never lets go: opening
      // it with today's tables would wait for that connection forever.
      const held = await new Promise<IDBDatabase>((ok) => {
        const r = indexedDB.open("magomap-u1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("drafts", { keyPath: "key" });
        r.onsuccess = () => ok(r.result);
      });
      window.history.pushState(null, "", "/account");
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(window.location.pathname).toBe("/signin"), { timeout: 8_000 });
      expect(sessionStorage.getItem("mm.removeResult")).toBe("kept");
      held.close();
    });

    /** Another tab's write that holds the account's drafts table until `release()` is called. */
    const holdWrite = async () => {
      const db = await new Promise<IDBDatabase>((ok) => {
        const r = indexedDB.open("magomap-u1");
        r.onsuccess = () => ok(r.result);
      });
      let held = true;
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      // Keep the transaction alive with one small request after another.
      const keepAlive = () => {
        if (!held) return;
        store.get("none").onsuccess = keepAlive;
      };
      keepAlive();
      const done = new Promise<void>((ok) => {
        tx.oncomplete = () => ok();
      });
      return async () => {
        held = false;
        await done;
        db.close();
      };
    };

    it("never clears the data later after saying it was kept", async () => {
      await i18n.changeLanguage("en");
      await seedDevice();
      const release = await holdWrite();
      window.history.pushState(null, "", "/account");
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(window.location.pathname).toBe("/signin"), { timeout: 8_000 });
      expect(sessionStorage.getItem("mm.removeResult")).toBe("kept");
      await release();
      await new Promise((r) => setTimeout(r, 300));
      expect(await draftsLeft()).toBe(1);
    });

    it("leaves another account that opened during the wait alone", async () => {
      await i18n.changeLanguage("en");
      await seedDevice();
      const release = await holdWrite();
      window.history.pushState(null, "", "/account");
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      // Another tab signs in as someone else while the removal waits.
      const other = openUserDb("u2");
      await new Promise((r) => setTimeout(r, 4_500));
      expect(window.location.pathname).toBe("/account");
      expect(openDbOrNull()).toBe(other);
      await release();
    });

    it("keeps the data when the server sign-out fails", async () => {
      await i18n.changeLanguage("en");
      await seedDevice();
      answerOnce("/api/auth/logout", () => Promise.reject(new Error("boom")));
      const user = userEvent.setup();
      renderAccount({ unsynced: 0 });
      await user.click(check());
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't reach the server/);
      expect(await draftsLeft()).toBe(1);
    });
  });

  describe("theme", () => {
    beforeEach(() => {
      localStorage.removeItem("mm.theme");
      delete document.documentElement.dataset.theme;
    });

    it("chooses the theme", async () => {
      await i18n.changeLanguage("en");
      const user = userEvent.setup();
      renderAccount();
      await user.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "Dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(localStorage.getItem("mm.theme")).toBe("dark");
    });

    it("shows the saved choice", async () => {
      await i18n.changeLanguage("en");
      localStorage.setItem("mm.theme", "light");
      renderAccount();
      expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("light");
    });

    it("follows a change made in another tab", async () => {
      await i18n.changeLanguage("en");
      renderAccount();
      const theme = screen.getByRole("combobox", { name: "Theme" });
      expect(theme).toHaveValue("system");
      localStorage.setItem("mm.theme", "dark");
      act(() => {
        window.dispatchEvent(new StorageEvent("storage", { key: "mm.theme", newValue: "dark" }));
      });
      expect(theme).toHaveValue("dark");
    });

    it("defaults to the device", async () => {
      await i18n.changeLanguage("en");
      renderAccount();
      const theme = screen.getByRole("combobox", { name: "Theme" });
      expect(theme).toHaveValue("system");
      expect(screen.getByRole("option", { name: "Same as this device" })).toBeInTheDocument();
      expect(theme).toHaveDisplayValue("Same as this device");
    });
  });
});
