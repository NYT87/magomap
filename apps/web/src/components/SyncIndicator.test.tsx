import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "../data/useSyncStatus";
import i18n from "../i18n";
import { SyncIndicator } from "./SyncIndicator";

const status = vi.hoisted(() => ({
  current: { state: "idle", unsynced: 0, rejected: 0 } as SyncStatus,
}));
vi.mock("../data/useSyncStatus", () => ({ useSyncStatus: () => status.current }));
vi.mock("../data/queries", () => ({ useRejected: () => [], dismissRejected: vi.fn() }));
vi.mock("../import/useOnline", () => ({ useOnline: () => true }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  status.current = { state: "idle", unsynced: 0, rejected: 0 } as SyncStatus;
});

describe("SyncIndicator, compact", () => {
  it("shows only an icon on phones, named by its status", () => {
    const { container } = render(<SyncIndicator compact />);
    expect(screen.getByRole("button", { name: "Synced" })).toHaveClass("mm-sync__icon");
    expect(container.querySelector(".mm-sync__pill")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("opens the full status with its actions", async () => {
    status.current = { state: "needs_signin", unsynced: 0, rejected: 0 };
    render(<SyncIndicator compact />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in again/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync" });
    expect(within(dialog).getByText("Sign in again to keep syncing")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Sign in again/ })).toHaveAttribute(
      "href",
      "/api/auth/kakao/start",
    );
  });

  it("marks refused changes on the icon", async () => {
    status.current = { state: "idle", unsynced: 0, rejected: 2 };
    const { container } = render(<SyncIndicator compact />);
    expect(container.querySelector(".mm-sync__icon .mm-sync__dot")).not.toBeNull();
    const icon = screen.getByRole("button", { name: "Synced. 2 changes couldn't be saved" });
    expect(icon).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("status")).toHaveTextContent("Synced. 2 changes couldn't be saved");
    await userEvent.click(icon);
    const dialog = screen.getByRole("dialog", { name: "Sync" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "2 changes couldn't be saved" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Changes that couldn't be saved" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["needs_signin", true],
    ["error", true],
    ["clock_ahead", true],
    ["offline", false],
    ["idle", false],
    ["syncing", false],
  ] as const)("%s: the icon is %s when it needs her", (state, attention) => {
    status.current = { state, unsynced: 0, rejected: 0 } as SyncStatus;
    render(<SyncIndicator compact />);
    const icon = screen.getByRole("button");
    expect(icon.hasAttribute("data-attention")).toBe(attention);
    if (state === "offline") expect(icon).toHaveAttribute("data-tone", "warn");
  });

  it("shows how many changes are not saved yet, capped at 9+", () => {
    status.current = { state: "offline", unsynced: 3, rejected: 0 };
    const view = render(<SyncIndicator compact />);
    const badge = view.container.querySelector(".mm-sync__count");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Offline — 3 changes saved on this phone",
    );
    status.current = { state: "offline", unsynced: 25, rejected: 0 };
    view.rerender(<SyncIndicator compact />);
    expect(view.container.querySelector(".mm-sync__count")).toHaveTextContent("9+");
    status.current = { state: "idle", unsynced: 0, rejected: 0 };
    view.rerender(<SyncIndicator compact />);
    expect(view.container.querySelector(".mm-sync__count")).toBeNull();
  });

  it("names the waiting count where the sentence has none", () => {
    status.current = { state: "syncing", unsynced: 2, rejected: 0 };
    render(<SyncIndicator compact />);
    const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(name).toBe("Syncing… 2 changes waiting to sync");
    expect(name).not.toContain("….");
  });

  it("keeps the waiting count out of the live region", () => {
    status.current = { state: "syncing", unsynced: 2, rejected: 0 };
    const view = render(<SyncIndicator compact />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Syncing…$/);
    status.current = { state: "syncing", unsynced: 3, rejected: 0 };
    view.rerender(<SyncIndicator compact />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Syncing…$/);
    status.current = { state: "syncing", unsynced: 3, rejected: 1 };
    view.rerender(<SyncIndicator compact />);
    expect(screen.getByRole("status")).toHaveTextContent("Syncing… 1 change couldn't be saved");
  });

  it("keeps focus in the sheet while the status changes, and returns it to the icon on close", async () => {
    status.current = { state: "needs_signin", unsynced: 0, rejected: 0 };
    const view = render(<SyncIndicator compact />);
    await userEvent.click(screen.getByRole("button", { name: /Sign in again/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync" });
    const link = within(dialog).getByRole("link");
    link.focus();
    status.current = { state: "needs_signin", unsynced: 2, rejected: 0 };
    view.rerender(<SyncIndicator compact />);
    expect(link).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".mm-sync__icon")).toHaveFocus();
  });

  it("announces status changes from inside the open sheet", async () => {
    const view = render(<SyncIndicator compact />);
    await userEvent.click(screen.getByRole("button", { name: "Synced" }));
    const dialog = screen.getByRole("dialog", { name: "Sync" });
    expect(within(dialog).getByRole("status")).toHaveTextContent("Synced");
    status.current = { state: "offline", unsynced: 0, rejected: 0 };
    view.rerender(<SyncIndicator compact />);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Offline");
  });

  it("returns focus to the icon after Sync leads to the refused changes and both close", async () => {
    status.current = { state: "idle", unsynced: 0, rejected: 1 };
    render(<SyncIndicator compact />);
    await userEvent.click(
      screen.getByRole("button", { name: "Synced. 1 change couldn't be saved" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "1 change couldn't be saved" }));
    expect(screen.getByRole("dialog", { name: "Changes that couldn't be saved" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".mm-sync__icon")).toHaveFocus();
  });

  it("keeps announcing changes", () => {
    const view = render(<SyncIndicator compact />);
    expect(screen.getByRole("status")).toHaveTextContent("Synced");
    status.current = { state: "offline", unsynced: 0, rejected: 0 };
    view.rerender(<SyncIndicator compact />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });
});

describe("SyncIndicator", () => {
  it("desktop keeps the pills", () => {
    const { container } = render(<SyncIndicator />);
    expect(container.querySelector(".mm-sync__pill")).toHaveTextContent("Synced");
    expect(container.querySelector(".mm-sync__icon")).toBeNull();
  });
});
