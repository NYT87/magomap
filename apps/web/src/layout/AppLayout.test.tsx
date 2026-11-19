import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import "../i18n";
import { setViewportWidth } from "../test/setup";
import { AppLayout } from "./AppLayout";

function renderAt(path: string, width: number) {
  setViewportWidth(width);
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <AppLayout map={<div data-testid="map" />}>
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
});
