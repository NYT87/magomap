import { describe, expect, it, vi } from "vitest";
import { createLeafletAdapter } from "./leafletAdapter";

describe("Leaflet adapter", () => {
  it("doesn't still report a waiting fit while doing it", async () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 400 });
    Object.defineProperty(el, "clientHeight", { value: 400 });
    document.body.append(el);
    const map = createLeafletAdapter();
    map.fitTo([{ lat: 37.57, lng: 126.98 }]);
    const seenDuringMove: unknown[] = [];
    map.onViewChange(() => seenDuringMove.push(map.pendingFit()));
    map.mount(el, { center: { lat: 35.68, lng: 139.69 }, zoom: 10 });
    await vi.waitFor(() => expect(seenDuringMove.length).toBeGreaterThan(0), { timeout: 5_000 });
    expect(seenDuringMove.at(-1)).toBeNull();
    expect(map.pendingFit()).toBeNull();
    map.destroy();
    el.remove();
  });
});
