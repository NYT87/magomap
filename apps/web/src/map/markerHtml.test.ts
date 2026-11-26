import { describe, expect, it } from "vitest";
import type { MapMarker } from "./MapAdapter";
import { markerElement, markerHtml } from "./markerHtml";

const saved: MapMarker = {
  id: "p1",
  placeId: "p1",
  position: { lat: 33.4, lng: 126.3 },
  color: "#7A4E7E",
  label: "빵집",
  kind: "saved",
};

describe("markerHtml", () => {
  it("draws the selected pin bigger, ringed, in its colour", () => {
    const html = markerHtml({ ...saved, selected: true });
    expect(html).toContain("mm-pin--selected");
    expect(html).toContain('width="40"');
    expect(html).toContain('fill="#7A4E7E"');
    expect(html).toContain("mm-pin__ring");
    const plain = markerHtml(saved);
    expect(plain).toContain('width="32"');
    expect(plain).not.toContain("mm-pin--selected");
    expect(plain).not.toContain("mm-pin__ring");
  });

  it("edges a saved pin in a darker shade, so a light colour still stands out on the map", () => {
    for (const html of [markerHtml(saved), markerHtml({ ...saved, color: "#ffc43b" })]) {
      expect(html).toContain('stroke="var(--color-pin-edge)"');
    }
  });

  it("escapes the label", () => {
    expect(markerHtml({ ...saved, label: `<b>"x"</b>` })).not.toContain("<b>");
    expect(markerHtml({ ...saved, selected: true, label: `<b>"x"</b>` })).not.toContain("<b>");
  });
});

describe("markerElement", () => {
  const parsed = (html: string) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    return t.content.firstElementChild as HTMLElement;
  };
  const base = { id: "a", position: { lat: 0, lng: 0 }, color: "#f96061", kind: "saved" as const };

  it("is the same pin markerHtml draws, for every kind", () => {
    for (const m of [
      { ...base, label: '바다정원 <카페> & "뷰"' },
      { ...base, label: "Selected", selected: true },
      { ...base, label: "Before", kind: "previous" as const },
      { ...base, label: "Found", kind: "search" as const },
    ]) {
      expect(markerElement(m).outerHTML).toBe(parsed(markerHtml(m)).outerHTML);
    }
  });

  it("gives each marker its own element", () => {
    const a = markerElement({ ...base, label: "One" });
    const b = markerElement({ ...base, label: "Two" });
    expect(a).not.toBe(b);
    expect(a.title).toBe("One");
    expect(b.title).toBe("Two");
  });
});
