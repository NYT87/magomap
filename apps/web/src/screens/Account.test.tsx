import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { SyncContext, type SyncControls } from "../data/SyncContext";
import i18n from "../i18n";
import { Account } from "./Account";

vi.mock("../api/client", async (orig) => {
  const actual = await orig<typeof import("../api/client")>();
  return { ...actual, apiFetch: vi.fn(async () => ({})) };
});
const { apiFetch } = await import("../api/client");

const me = { userId: "u1", displayName: "지은", identities: [{ provider: "kakao" as const }] };

function renderAccount(sync: Partial<SyncControls> = {}) {
  const controls: SyncControls = { unsynced: 0, syncNow: vi.fn(async () => {}), ...sync };
  render(
    <SyncContext.Provider value={controls}>
      <Account me={me} />
    </SyncContext.Provider>,
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
      expect(apiFetch).toHaveBeenCalledWith("/api/account", { method: "DELETE" }),
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
      expect(apiFetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" }),
    );
    expect(await Dexie.exists("magomap-u1")).toBe(true);
  });
});
