import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, watchLongPress } from "./longPress";

type Point = { clientX: number; clientY: number };

function touch(target: EventTarget, type: string, touches: Point[]) {
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === "touchend" || type === "touchcancel" ? [] : (touches as never),
    changedTouches: touches as never,
  });
  target.dispatchEvent(event);
  return event;
}

let el: HTMLElement;
let pressed: ReturnType<typeof vi.fn<(client: { x: number; y: number }) => void>>;
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement("div");
  document.body.append(el);
  pressed = vi.fn<(client: { x: number; y: number }) => void>();
  stop = watchLongPress(el, pressed);
});

afterEach(() => {
  stop();
  el.remove();
  vi.useRealTimers();
});

describe("watchLongPress", () => {
  it("is half a second, within 10 px", () => {
    expect(LONG_PRESS_MS).toBe(500);
    expect(LONG_PRESS_SLOP_PX).toBe(10);
  });

  it("fires once, where the finger went down, after half a second held", () => {
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(499);
    expect(pressed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(pressed).toHaveBeenCalledOnce();
    expect(pressed).toHaveBeenCalledWith({ x: 100, y: 200 });
    vi.advanceTimersByTime(2_000);
    expect(pressed).toHaveBeenCalledOnce();
  });

  it("doesn't fire when the finger moves 11 px (a pan)", () => {
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    touch(el, "touchmove", [{ clientX: 111, clientY: 200 }]);
    vi.advanceTimersByTime(1_000);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("still fires when the finger wobbles 9 px", () => {
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    touch(el, "touchmove", [{ clientX: 100, clientY: 209 }]);
    vi.advanceTimersByTime(500);
    expect(pressed).toHaveBeenCalledOnce();
  });

  it("doesn't fire with two fingers (a pinch)", () => {
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    touch(el, "touchstart", [
      { clientX: 100, clientY: 200 },
      { clientX: 150, clientY: 250 },
    ]);
    vi.advanceTimersByTime(1_000);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("doesn't fire after the finger lifts or the touch is cancelled (a tap)", () => {
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(200);
    touch(el, "touchend", [{ clientX: 100, clientY: 200 }]);
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    touch(el, "touchcancel", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(1_000);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("doesn't fire for a press that starts on a link or a map control", () => {
    const control = document.createElement("div");
    control.className = "leaflet-control";
    const link = document.createElement("a");
    control.append(link);
    el.append(control);
    touch(link, "touchstart", [{ clientX: 5, clientY: 5 }]);
    vi.advanceTimersByTime(1_000);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("cancels the click that lifting the finger would send, and keeps the browser's menu away", () => {
    const clicked = vi.fn();
    document.addEventListener("click", clicked);
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(500);
    // While the finger is still down: no menu, no click.
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicked).not.toHaveBeenCalled();
    // Lifting it: its touchend is cancelled, so the browser sends no click for it.
    const end = touch(el, "touchend", [{ clientX: 100, clientY: 200 }]);
    expect(end.defaultPrevented).toBe(true);
    // A late menu from the same press is still kept away.
    const late = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(true);
    document.removeEventListener("click", clicked);
  });

  it("lets her next tap through at once, on what the press opened", () => {
    const clicked = vi.fn();
    document.addEventListener("click", clicked);
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(500);
    touch(el, "touchend", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(100);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicked).toHaveBeenCalledOnce();
    document.removeEventListener("click", clicked);
  });

  it("fires at once, and only once, when the browser's own long-press menu comes first", () => {
    const inner = vi.fn();
    el.addEventListener("contextmenu", inner);
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(400);
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    el.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(inner).not.toHaveBeenCalled();
    expect(pressed).toHaveBeenCalledOnce();
    expect(pressed).toHaveBeenCalledWith({ x: 100, y: 200 });
    vi.advanceTimersByTime(1_000);
    expect(pressed).toHaveBeenCalledOnce();
  });

  it("leaves a right-click with no finger down to the map", () => {
    const inner = vi.fn();
    el.addEventListener("contextmenu", inner);
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(inner).toHaveBeenCalledOnce();
    expect(pressed).not.toHaveBeenCalled();
  });

  it("leaves a tap's touchend alone", () => {
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    const end = touch(el, "touchend", [{ clientX: 100, clientY: 200 }]);
    expect(end.defaultPrevented).toBe(false);
  });

  it("stops listening after the cleanup", () => {
    stop();
    touch(el, "touchstart", [{ clientX: 100, clientY: 200 }]);
    vi.advanceTimersByTime(1_000);
    expect(pressed).not.toHaveBeenCalled();
  });
});
