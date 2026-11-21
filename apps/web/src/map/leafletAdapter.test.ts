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

  it("keeps the selected pin out of the cluster, above the others", async () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 400 });
    Object.defineProperty(el, "clientHeight", { value: 400 });
    document.body.append(el);
    const map = createLeafletAdapter();
    const at = { lat: 37.57, lng: 126.98 };
    const pin = (id: string, selected = false) => ({
      id,
      position: at,
      color: "#123456",
      label: id,
      kind: "saved" as const,
      ...(selected ? { selected } : {}),
    });
    map.setMarkers([pin("a"), pin("b"), pin("c", true)]);
    map.mount(el, { center: at, zoom: 10 });
    await vi.waitFor(() => expect(el.querySelector(".mm-pin--selected")).not.toBeNull(), {
      timeout: 5_000,
    });
    const selected = el.querySelector(".mm-pin--selected");
    expect(selected?.closest(".marker-cluster")).toBeNull();
    // The two others, at the same spot, are one cluster of two; the selected pin isn't in it.
    const clusters = [...el.querySelectorAll(".marker-cluster")];
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.textContent).toContain("2");
    const host = selected?.closest(".leaflet-marker-icon") as HTMLElement;
    const others = [...el.querySelectorAll(".leaflet-marker-icon")].filter((n) => n !== host);
    for (const o of others) {
      expect(Number((host as HTMLElement).style.zIndex)).toBeGreaterThan(
        Number((o as HTMLElement).style.zIndex),
      );
    }
    expect(Number(host.style.zIndex)).toBeGreaterThanOrEqual(1000);
    map.destroy();
    el.remove();
  });
});
