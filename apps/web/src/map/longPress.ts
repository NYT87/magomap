/** How long a finger must stay down for a press. */
export const LONG_PRESS_MS = 500;
/** How far the finger may wander and still count as held (more is a pan). */
export const LONG_PRESS_SLOP_PX = 10;
/** After a press, how long the click and menu that lifting the finger sends are swallowed. */
const AFTER_PRESS_MS = 600;
/** A press that starts on one of these is theirs, not the map's. */
const NOT_THE_MAP = ".leaflet-control, a, input, textarea, select";

/**
 * Calls `onPress` once when a single finger is held still on `el` for LONG_PRESS_MS (or when the
 * browser's own long-press menu comes first), at the client point where it went down. A pan, a
 * pinch or a tap never counts. After a press, the browser's menu and the click that lifting the
 * finger sends are swallowed, so the press doesn't also open a place or close what it opened.
 * Returns a cleanup.
 */
export function watchLongPress(
  el: HTMLElement,
  onPress: (client: { x: number; y: number }) => void,
): () => void {
  let held: { x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  let afterPress: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    held = null;
  };
  const fire = () => {
    const at = held;
    cancel();
    if (!at) return;
    pressed = true;
    onPress(at);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onStart = (e: TouchEvent) => {
    clearTimeout(afterPress);
    pressed = false;
    const first = e.touches[0];
    const target = e.target instanceof Element ? e.target : null;
    if (e.touches.length !== 1 || !first || target?.closest(NOT_THE_MAP)) return cancel();
    held = { x: first.clientX, y: first.clientY };
    clearTimeout(timer);
    timer = setTimeout(fire, LONG_PRESS_MS);
  };
  const onMove = (e: TouchEvent) => {
    const now = e.touches[0];
    if (!held || !now) return;
    if (e.touches.length !== 1) return cancel();
    if (Math.hypot(now.clientX - held.x, now.clientY - held.y) > LONG_PRESS_SLOP_PX) cancel();
  };
  const onEnd = (e: TouchEvent) => {
    cancel();
    if (!pressed) return;
    // No click (and no mouse events) from lifting the finger after a press.
    if (e.type === "touchend" && e.cancelable) e.preventDefault();
    clearTimeout(afterPress);
    afterPress = setTimeout(() => {
      pressed = false;
    }, AFTER_PRESS_MS);
  };
  // On the window, before anything else: the menu or click may land on what the press opened.
  const onMenu = (e: Event) => {
    if (held) {
      swallow(e);
      fire();
    } else if (pressed) swallow(e);
  };
  const onClick = (e: Event) => {
    if (pressed) swallow(e);
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: true });
  el.addEventListener("touchend", onEnd, { passive: false });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  window.addEventListener("contextmenu", onMenu, { capture: true });
  window.addEventListener("click", onClick, { capture: true });
  return () => {
    cancel();
    clearTimeout(afterPress);
    pressed = false;
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
    window.removeEventListener("contextmenu", onMenu, { capture: true });
    window.removeEventListener("click", onClick, { capture: true });
  };
}
