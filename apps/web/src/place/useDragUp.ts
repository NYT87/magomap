import {
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  useRef,
  useState,
} from "react";

/** How far the card follows the finger, and how a gesture is told apart from a tap or a scroll. */
const MAX_OFFSET = 160;
const SLOP = 8;
const FLICK_DISTANCE = 16;
const FLICK_SPEED = 0.4; // px per ms

interface Options {
  onOpen: () => void;
  /** Upward distance in px that opens on release (default 64). */
  threshold?: number;
  /** A tap on the card (not on a button inside it) opens too, as in Kakao Map. */
  openOnTap?: boolean;
}

interface Gesture {
  x: number;
  y: number;
  at: number;
  moved: boolean;
}

/**
 * Drag a card up to open it. The card follows the finger upward (offset <= 0); releasing past the
 * threshold, or with a quick upward flick, calls `onOpen`; otherwise it springs back. Spread
 * `handlers` on the card. The pointer events stop here so the map under the card never pans, and
 * the pointer is captured at once, except on a button inside the card (captured only once the
 * finger has really moved), so a tap on that button still reaches it. The click that ends a drag
 * is swallowed, so a short drag that springs back is never taken for a tap.
 */
export function useDragUp({ onOpen, threshold = 64, openOnTap = false }: Options): {
  handlers: Pick<
    HTMLAttributes<HTMLElement>,
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
    | "onPointerCancel"
    | "onClickCapture"
    | "onClick"
    | "style"
  >;
  offset: number;
  dragging: boolean;
} {
  const gesture = useRef<Gesture | null>(null);
  // Set when a drag ends: the click the browser sends after it isn't a tap.
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    gesture.current = null;
    setOffset(0);
    setDragging(false);
  };

  const capture = (e: PointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer that is already gone can't be captured; the drag still works.
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    swallowClick.current = false;
    gesture.current = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
    // A mouse leaving the card would drop the drag, so capture at once, except on a button:
    // capturing there would send its click to the card instead.
    if (!(e.target as HTMLElement).closest("button")) capture(e);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved) {
      // Not yet a drag: a sideways or downward move never becomes one.
      if (Math.hypot(dx, dy) < SLOP) return;
      if (dy >= 0 || Math.abs(dx) > Math.abs(dy)) {
        gesture.current = null;
        return;
      }
      g.moved = true;
      setDragging(true);
      capture(e);
    }
    setOffset(Math.max(dy, -MAX_OFFSET));
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const g = gesture.current;
    reset();
    if (!g?.moved) return;
    swallowClick.current = true;
    const up = g.y - e.clientY;
    const sideways = Math.abs(e.clientX - g.x);
    const speed = up / Math.max(performance.now() - g.at, 1);
    const flick = up >= FLICK_DISTANCE && speed >= FLICK_SPEED && up > sideways;
    if ((up >= threshold && up > sideways) || flick) onOpen();
  };

  const onPointerCancel = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    reset();
  };

  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    // Buttons inside the card do their own thing; the card itself opens.
    if (openOnTap && !(e.target as HTMLElement).closest("button")) onOpen();
  };

  const style: CSSProperties = { touchAction: "none" };
  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
      onClick,
      style,
    },
    offset,
    dragging,
  };
}
