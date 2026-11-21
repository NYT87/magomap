import type { PlaceRow } from "@magomap/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import "../i18n";
import { VisiblePlacesList } from "./VisiblePlacesList";

const place = (id: string, title: string) =>
  ({ id, title, address: null, roadAddress: null }) as unknown as PlaceRow;

describe("VisiblePlacesList", () => {
  it("marks the open place", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <VisiblePlacesList places={[place("p1", "Alpha"), place("p2", "Beta")]} selectedId="p1" />
      </Router>,
    );
    expect(screen.getByRole("link", { name: /Alpha/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: /Beta/ }).hasAttribute("aria-current")).toBe(false);
  });
});
