import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import i18n from "../i18n";
import { setViewportWidth } from "../test/setup";
import { AppLayout, NoticeSlot } from "./AppLayout";
import { placeRouteOf, switchesPlace } from "./placeRoute";

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
    renderAt("/places/x/details", 390);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText("place page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back|뒤로/i })).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("keeps the map and the bottom nav on a phone place route, with no page", () => {
    const { container } = renderAt("/places/p1", 390);
    expect(container.querySelector(".mm-map")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(container.querySelector(".mm-page")).toBeNull();
    expect(container.querySelector(".mm-page__header")).toBeNull();
    expect(screen.queryByText("place page")).toBeNull();
  });

  it("hides the map under the details page on a phone", () => {
    const { container } = renderAt("/places/p1/details", 390);
    expect(container.querySelector(".mm-map")).toHaveAttribute("hidden");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("place page")).toBeInTheDocument();
  });

  it("shows a place in the panel on desktop, at both place routes", () => {
    for (const path of ["/places/p1", "/places/p1/details"]) {
      const { unmount } = renderAt(path, 1440);
      expect(screen.getByRole("complementary")).toHaveTextContent("place page");
      unmount();
    }
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

describe("closing a place on a phone", () => {
  function renderPhone(path: string) {
    setViewportWidth(390);
    const location = memoryLocation({ path, record: true });
    render(
      <Router hook={location.hook}>
        <AppLayout map={<input id="mm-search" aria-label="search" />}>
          <p>page</p>
        </AppLayout>
      </Router>,
    );
    return location;
  }

  it("Escape closes the peek, as the X does", async () => {
    const { history } = renderPhone("/places/p1");
    await userEvent.keyboard("{Escape}");
    expect(history.at(-1)).toBe("/");
  });

  it("Escape on the details page does not close the place", async () => {
    const { history } = renderPhone("/places/p1/details");
    await userEvent.keyboard("{Escape}");
    expect(history.at(-1)).toBe("/places/p1/details");
  });

  it("back on the map from a peek puts focus in the search field", async () => {
    const { navigate } = renderPhone("/places/p1");
    act(() => navigate("/"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "search" })).toHaveFocus());
  });
});

describe("switchesPlace", () => {
  it("is true only on a place's peek, so opening another place replaces it in history", () => {
    expect(switchesPlace("/places/a")).toBe(true);
    expect(switchesPlace("/places/a/details")).toBe(false);
    expect(switchesPlace("/")).toBe(false);
    expect(switchesPlace("/lists/x")).toBe(false);
  });
});

describe("placeRouteOf", () => {
  it("reads the place and whether it is the details page", () => {
    expect(placeRouteOf("/places/p1")).toEqual({ id: "p1", details: false });
    expect(placeRouteOf("/places/p1/")).toEqual({ id: "p1", details: false });
    expect(placeRouteOf("/places/p1/details")).toEqual({ id: "p1", details: true });
    expect(placeRouteOf("/places/a%20b")).toEqual({ id: "a b", details: false });
    expect(placeRouteOf("/places/a%20b/details")).toEqual({ id: "a b", details: true });
  });

  it("is null for other routes", () => {
    expect(placeRouteOf("/places")).toBeNull();
    expect(placeRouteOf("/places/")).toBeNull();
    expect(placeRouteOf("/lists/x")).toBeNull();
    expect(placeRouteOf("/")).toBeNull();
    expect(placeRouteOf("/places/p1/other")).toBeNull();
  });

  it("never throws on a broken escape", () => {
    expect(placeRouteOf("/places/%E0%A4%A")).toEqual({ id: "%E0%A4%A", details: false });
  });
});
