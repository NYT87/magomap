import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";

vi.mock("../data/useSyncStatus", () => ({
  useSyncStatus: () => ({ state: "needs_signin", unsynced: 0, rejected: 0 }),
}));
const { openUserDb } = await import("../data/db");
const { SyncIndicator } = await import("./SyncIndicator");

let n = 0;
beforeEach(async () => {
  n += 1;
  await i18n.changeLanguage("en");
});

describe("SyncIndicator", () => {
  it("names the account when signing in again", async () => {
    openUserDb(`si-named${n}`);
    localStorage.setItem(`mm.name.si-named${n}`, "지은");
    render(<SyncIndicator />);
    expect(screen.getAllByText("Sign in again as 지은 to keep syncing").length).toBeGreaterThan(0);
  });

  it("says plainly to sign in again when the account has no name", async () => {
    openUserDb(`si-plain${n}`);
    render(<SyncIndicator />);
    expect(screen.getAllByText("Sign in again to keep syncing").length).toBeGreaterThan(0);
  });
});
