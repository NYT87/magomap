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
    await userEvent.click(screen.getByRole("button", { name: "Synced" }));
    const dialog = screen.getByRole("dialog", { name: "Sync" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "2 changes couldn't be saved" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Changes that couldn't be saved" }),
    ).toBeInTheDocument();
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
