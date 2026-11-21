import { describe, expect, it } from "vitest";
import type { MapMarker } from "./MapAdapter";
import { markerHtml } from "./markerHtml";

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

  it("escapes the label", () => {
    expect(markerHtml({ ...saved, label: `<b>"x"</b>` })).not.toContain("<b>");
    expect(markerHtml({ ...saved, selected: true, label: `<b>"x"</b>` })).not.toContain("<b>");
  });
});
