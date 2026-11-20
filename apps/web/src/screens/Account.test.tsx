import type { Me } from "@magomap/domain";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { NetworkError } from "../api/client";
import { SyncContext, type SyncControls } from "../data/SyncContext";
import i18n from "../i18n";
import { MapPrefsProvider } from "../map/mapPrefs";
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
  vi.mocked(apiFetch).mockImplementation(async () => ({}));
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
});
