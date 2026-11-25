/** How long a finger must stay down for a press. */
export const LONG_PRESS_MS = 500;
/** How far the finger may wander and still count as held (more is a pan). */
export const LONG_PRESS_SLOP_PX = 10;
/** After a press, how long a late browser menu for it is still swallowed. */
const AFTER_PRESS_MS = 600;
/** A press that starts on one of these is theirs, not the map's. */
const NOT_THE_MAP = ".leaflet-control, a, input, textarea, select";

/**
 * Calls `onPress` once when a single finger is held still on `el` for LONG_PRESS_MS (or when the
 * browser's own long-press menu comes first), at the client point where it went down. A pan, a
 * pinch or a tap never counts. After a press, the browser's menu is swallowed; while the finger
 * stays down it can't drag the map under what the press opened; lifting it sends no click (its
 * touchend is cancelled), so the press doesn't also open a place or close what it opened, and her
 * next tap goes through. The lift is watched on the window: what the press opens may make the map
 * inert, and the finger may lift anywhere. Returns a cleanup.
 */
export function watchLongPress(
  el: HTMLElement,
  onPress: (client: { x: number; y: number }) => void,
): () => void {
  let held: { x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** A press fired recently: a late browser menu for it is swallowed. */
  let pressed = false;
  /** The pressing finger is still down: it mustn't move the map. */
  let holding = false;
  /** The pressing finger's touchend is still to come: its click is cancelled. */
  let liftPending = false;
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
    holding = true;
    liftPending = true;
    onPress(at);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const released = () => {
    holding = false;
    if (!pressed) return;
    clearTimeout(afterPress);
    afterPress = setTimeout(() => {
      pressed = false;
    }, AFTER_PRESS_MS);
  };

  const onStart = (e: TouchEvent) => {
    clearTimeout(afterPress);
    pressed = false;
    holding = false;
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
  // On the window, before anything else: the menu may land on what the press opened, and the
  // finger may lift or move over it.
  const onAnyStart = () => {
    // A new touch: the pressing finger is up, whatever became of its lift.
    liftPending = false;
    if (holding) released();
  };
  const onAnyMove = (e: Event) => {
    if (!holding) return;
    // Neither the browser nor the map (whose own listeners come later) moves for this finger.
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  };
  const onAnyEnd = (e: TouchEvent) => {
    cancel();
    // No click (and no mouse events) from lifting the finger after a press.
    if (liftPending && e.type === "touchend" && e.cancelable) e.preventDefault();
    liftPending = false;
    released();
  };
  const onAnyPointerUp = () => {
    if (holding) released();
  };
  const onMenu = (e: Event) => {
    if (held) {
      swallow(e);
      fire();
    } else if (pressed) swallow(e);
  };

  const capture = { capture: true };
  const active = { capture: true, passive: false };
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchstart", onAnyStart, { capture: true, passive: true });
  window.addEventListener("touchmove", onAnyMove, active);
  window.addEventListener("pointermove", onAnyMove, capture);
  window.addEventListener("touchend", onAnyEnd, active);
  window.addEventListener("touchcancel", onAnyEnd, active);
  window.addEventListener("pointerup", onAnyPointerUp, capture);
  window.addEventListener("pointercancel", onAnyPointerUp, capture);
  window.addEventListener("contextmenu", onMenu, capture);
  return () => {
    cancel();
    clearTimeout(afterPress);
    pressed = false;
    holding = false;
    liftPending = false;
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchstart", onAnyStart, capture);
    window.removeEventListener("touchmove", onAnyMove, capture);
    window.removeEventListener("pointermove", onAnyMove, capture);
    window.removeEventListener("touchend", onAnyEnd, capture);
    window.removeEventListener("touchcancel", onAnyEnd, capture);
    window.removeEventListener("pointerup", onAnyPointerUp, capture);
    window.removeEventListener("pointercancel", onAnyPointerUp, capture);
    window.removeEventListener("contextmenu", onMenu, capture);
  };
}
