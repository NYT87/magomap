import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import i18n from "../i18n";
import { setViewportWidth } from "../test/setup";
import { AppLayout, NoticeSlot } from "./AppLayout";

function renderAt(path: string, width: number, notice?: ReactNode) {
  setViewportWidth(width);
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <AppLayout
        map={
          <div data-testid="map">
            <div data-testid="notes">
              <NoticeSlot />
            </div>
          </div>
        }
        status={<span data-testid="status" />}
        notice={notice}
      >
        <p>place page</p>
      </AppLayout>
    </Router>,
  );
}

describe("AppLayout", () => {
  it("shows pages in the side panel beside the map on desktop", () => {
    renderAt("/places/x", 1440);
    const panel = screen.getByRole("complementary");
    expect(panel).toHaveTextContent("place page");
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("shows pages full-screen over the map on phones, with a back button", () => {
    renderAt("/places/x", 390);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText("place page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back|뒤로/i })).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("shows only the map at the root on phones", () => {
    renderAt("/", 390);
    expect(screen.queryByText("place page")).toBeNull();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("has Map, Lists and Account tabs, and no Import tab", async () => {
    await i18n.changeLanguage("en");
    renderAt("/account", 1440);
    const nav = screen.getByRole("navigation");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Map", "Lists", "Account"]);
  });

  it("shows the update notice under the sync status in the desktop panel header", () => {
    renderAt("/", 1440, <p data-testid="notice">update</p>);
    const header = screen.getByRole("complementary").querySelector(".mm-panel__header");
    const column = header?.querySelector(".mm-status");
    expect(column?.children[0]).toContainElement(screen.getByTestId("status"));
    expect(column).toContainElement(screen.getByTestId("notice"));
  });

  it("shows the update notice as a strip under the header on phone pages", () => {
    const { container } = renderAt("/account", 390, <p data-testid="notice">update</p>);
    const header = container.querySelector(".mm-page__header");
    const strip = screen.getByTestId("notice").closest(".mm-page__notice");
    expect(strip).not.toBeNull();
    expect(header?.nextElementSibling).toBe(strip);
    expect(header).not.toContainElement(screen.getByTestId("notice"));
  });

  it("shows the update notice in the notes area on the phone map", () => {
    renderAt("/", 390, <p data-testid="notice">update</p>);
    expect(screen.getByTestId("notes")).toContainElement(screen.getByTestId("notice"));
  });

  it("doesn't float the sync status over the map on phones", () => {
    const { container } = renderAt("/", 390, <p>update</p>);
    expect(container.querySelector(".mm-phone-status")).toBeNull();
    expect(screen.queryByTestId("status")).toBeNull();
  });

  it("shows the page title in the header on phones", async () => {
    await i18n.changeLanguage("en");
    const pages: [string, string][] = [
      ["/account", "Account"],
      ["/lists", "Lists"],
    ];
    for (const [path, title] of pages) {
      const { container, unmount } = renderAt(path, 390);
      const header = container.querySelector("header") as HTMLElement;
      expect(within(header).getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
      unmount();
    }
  });

  it("keeps other titles in the page", () => {
    const { container } = renderAt("/lists/abc", 390);
    const header = container.querySelector("header") as HTMLElement;
    expect(within(header).queryByRole("heading")).toBeNull();
  });
});
