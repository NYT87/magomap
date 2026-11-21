import { afterEach, describe, expect, it, vi } from "vitest";
import { createKakaoAdapter } from "./kakaoAdapter";

type Opts = { zIndex?: number; map?: unknown; content: HTMLElement };

/** A stand-in for the Kakao SDK that records overlays and what the clusterer was given. */
function stubKakao() {
  const overlays: { opts: Opts; setMap: ReturnType<typeof vi.fn> }[] = [];
  const clustered: unknown[][] = [];
  class CustomOverlay {
    setMap = vi.fn();
    constructor(public opts: Opts) {
      overlays.push(this);
    }
  }
  class MarkerClusterer {
    addMarkers(ms: unknown[]) {
      clustered.push(ms);
    }
    clear() {}
  }
  class KMap {}
  class LatLng {
    constructor(
      public lat: number,
      public lng: number,
    ) {}
  }
  (window as unknown as { kakao: unknown }).kakao = {
    maps: {
      LatLng,
      Map: KMap,
      CustomOverlay,
      MarkerClusterer,
      event: { addListener() {} },
    },
  };
  return { overlays, clustered };
}

afterEach(() => {
  delete (window as unknown as { kakao?: unknown }).kakao;
});

describe("Kakao adapter", () => {
  it("keeps the selected pin out of the clusterer, above the others", () => {
    const { overlays, clustered } = stubKakao();
    const map = createKakaoAdapter();
    map.mount(document.createElement("div"), { center: { lat: 37.5, lng: 127 }, zoom: 10 });
    const at = { lat: 37.5, lng: 127 };
    const pin = (id: string, selected = false) => ({
      id,
      position: at,
      color: "#123456",
      label: id,
      kind: "saved" as const,
      ...(selected ? { selected } : {}),
    });
    map.setMarkers([pin("a"), pin("b"), pin("c", true)]);
    const selected = overlays.find((o) => o.opts.content.getAttribute("aria-label") === "c");
    expect(selected?.setMap).toHaveBeenCalledOnce();
    expect(selected?.opts.zIndex).toBeGreaterThan(0);
    expect(clustered.at(-1)).toHaveLength(2);
    expect(clustered.at(-1)).not.toContain(selected);
    for (const o of overlays.filter((o) => o !== selected)) expect(o.opts.zIndex).toBeUndefined();
  });
});
