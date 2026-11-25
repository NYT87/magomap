import { afterEach, describe, expect, it, vi } from "vitest";
import { createKakaoAdapter } from "./kakaoAdapter";
import type { ContextPress } from "./MapAdapter";

type Opts = { zIndex?: number; map?: unknown; content: HTMLElement };

/** A stand-in for the Kakao SDK that records overlays and what the clusterer was given. */
function stubKakao() {
  const overlays: { opts: Opts; setMap: ReturnType<typeof vi.fn> }[] = [];
  const listeners: { target: unknown; type: string; cb: (e?: unknown) => void }[] = [];
  const clustered: unknown[][] = [];
  const mapOptions: unknown[] = [];
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
  class LatLng {
    constructor(
      public lat: number,
      public lng: number,
    ) {}
    getLat() {
      return this.lat;
    }
    getLng() {
      return this.lng;
    }
  }
  class Point {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  // A projection where one container pixel is 0.001 degrees from (37, 127) at the top left.
  class KMap {
    constructor(_el: HTMLElement, opts: unknown) {
      mapOptions.push(opts);
    }
    // What's on screen: 37.0–37.1 N, 127.0–127.1 E.
    getBounds() {
      return {
        getSouthWest: () => new LatLng(37, 127),
        getNorthEast: () => new LatLng(37.1, 127.1),
      };
    }
    getProjection() {
      return {
        coordsFromContainerPoint: (p: Point) => new LatLng(37 - p.y * 0.001, 127 + p.x * 0.001),
      };
    }
  }
  (window as unknown as { kakao: unknown }).kakao = {
    maps: {
      LatLng,
      Point,
      Map: KMap,
      CustomOverlay,
      MarkerClusterer,
      event: {
        addListener(target: unknown, type: string, cb: (e?: unknown) => void) {
          listeners.push({ target, type, cb });
        },
      },
    },
  };
  return { overlays, clustered, listeners, mapOptions };
}

afterEach(() => {
  delete (window as unknown as { kakao?: unknown }).kakao;
});

describe("Kakao adapter", () => {
  it("lets the keyboard move and zoom the map (arrows, + and -) once it has focus", () => {
    const { mapOptions } = stubKakao();
    createKakaoAdapter().mount(document.createElement("div"), {
      center: { lat: 37.5, lng: 127 },
      zoom: 10,
    });
    // https://apis.map.kakao.com/web/documentation/#MapOptions (keyboardShortcuts, default false)
    expect(mapOptions[0]).toMatchObject({ keyboardShortcuts: true });
  });

  it("tells a place well on screen from one near an edge or off it, from Kakao's bounds", () => {
    stubKakao();
    const adapter = createKakaoAdapter();
    adapter.mount(document.createElement("div"), { center: { lat: 37.05, lng: 127.05 }, zoom: 16 });
    expect(adapter.isWellInView({ lat: 37.05, lng: 127.05 })).toBe(true);
    expect(adapter.isWellInView({ lat: 37.005, lng: 127.05 })).toBe(false);
    expect(adapter.isWellInView({ lat: 38, lng: 127.05 })).toBe(false);
  });

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

  /** A host in a 400 × 400 box whose top left sits at (10, 20) on the page. */
  function host() {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 400 }) as DOMRect;
    document.body.append(el);
    return el;
  }

  it("reports Kakao's right-click with its point, placed on the page", () => {
    const { listeners } = stubKakao();
    const map = createKakaoAdapter();
    const el = host();
    map.mount(el, { center: { lat: 37.5, lng: 127 }, zoom: 10 });
    const presses: ContextPress[] = [];
    map.onContextPress((p) => presses.push(p));
    const rightclick = listeners.find((l) => l.type === "rightclick");
    expect(rightclick).toBeDefined();
    const { LatLng, Point } = (
      window as unknown as {
        kakao: {
          maps: {
            LatLng: new (a: number, b: number) => unknown;
            Point: new (x: number, y: number) => unknown;
          };
        };
      }
    ).kakao.maps;
    rightclick?.cb({ latLng: new LatLng(37.4, 127.1), point: new Point(30, 40) });
    expect(presses).toEqual([{ point: { lat: 37.4, lng: 127.1 }, at: { x: 40, y: 60 } }]);
    map.destroy();
    el.remove();
  });

  it("makes the map focusable, as Leaflet does", () => {
    stubKakao();
    const map = createKakaoAdapter();
    const el = host();
    expect(el.tabIndex).toBe(-1);
    map.mount(el, { center: { lat: 37.5, lng: 127 }, zoom: 10 });
    expect(el.tabIndex).toBe(0);
    map.destroy();
    el.remove();
  });

  it("keeps the browser's own menu off the map", () => {
    stubKakao();
    const map = createKakaoAdapter();
    const el = host();
    map.mount(el, { center: { lat: 37.5, lng: 127 }, zoom: 10 });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    map.destroy();
    el.remove();
  });

  it("reports a long-press at the point the map projects for that pixel", () => {
    stubKakao();
    const map = createKakaoAdapter();
    const el = host();
    map.mount(el, { center: { lat: 37.5, lng: 127 }, zoom: 10 });
    const presses: ContextPress[] = [];
    map.onContextPress((p) => presses.push(p));
    vi.useFakeTimers();
    try {
      const at = { clientX: 110, clientY: 220 };
      el.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [at] as never,
          changedTouches: [at] as never,
        }),
      );
      vi.advanceTimersByTime(500);
    } finally {
      vi.useRealTimers();
    }
    expect(presses).toHaveLength(1);
    expect(presses[0]?.at).toEqual({ x: 110, y: 220 });
    // Container pixel (100, 200).
    expect(presses[0]?.point.lat).toBeCloseTo(36.8, 6);
    expect(presses[0]?.point.lng).toBeCloseTo(127.1, 6);
    map.destroy();
    el.remove();
  });
});
