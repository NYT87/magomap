import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDragUp } from "./useDragUp";

function Card({ onOpen, onParent }: { onOpen: () => void; onParent: () => void }) {
  const { handlers, offset, dragging } = useDragUp({ onOpen });
  return (
    <div
      role="presentation"
      onPointerDown={onParent}
      onPointerMove={onParent}
      onPointerUp={onParent}
    >
      <div
        data-testid="card"
        data-offset={offset}
        data-dragging={dragging}
        style={{ touchAction: "pan-x" }}
        {...handlers}
      >
        card
      </div>
    </div>
  );
}

let now = 1000;
vi.spyOn(performance, "now").mockImplementation(() => now);
afterEach(() => {
  now = 1000;
});

function setup() {
  const onOpen = vi.fn();
  const onParent = vi.fn();
  render(<Card onOpen={onOpen} onParent={onParent} />);
  const card = screen.getByTestId("card");
  const at = (
    type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
    x: number,
    y: number,
  ) =>
    act(() => {
      fireEvent[type](card, { clientX: x, clientY: y, pointerId: 1 });
    });
  return { onOpen, onParent, card, at };
}

describe("useDragUp", () => {
  it("opens once when the card is dragged up past the threshold", () => {
    const { onOpen, card, at } = setup();
    at("pointerDown", 100, 500);
    now += 400;
    at("pointerMove", 100, 420);
    expect(card.dataset.offset).toBe("-80");
    expect(card.dataset.dragging).toBe("true");
    at("pointerUp", 100, 420);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(card.dataset.offset).toBe("0");
  });

  it("springs back when released short of the threshold", () => {
    const { onOpen, card, at } = setup();
    at("pointerDown", 100, 500);
    now += 400;
    at("pointerMove", 100, 470);
    expect(card.dataset.offset).toBe("-30");
    at("pointerUp", 100, 470);
    expect(onOpen).not.toHaveBeenCalled();
    expect(card.dataset.offset).toBe("0");
    expect(card.dataset.dragging).toBe("false");
  });

  it("ignores a drag down", () => {
    const { onOpen, card, at } = setup();
    at("pointerDown", 100, 500);
    now += 400;
    at("pointerMove", 100, 600);
    expect(card.dataset.offset).toBe("0");
    at("pointerUp", 100, 600);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores a sideways drag", () => {
    const { onOpen, at } = setup();
    at("pointerDown", 100, 500);
    now += 400;
    at("pointerMove", 300, 490);
    at("pointerUp", 300, 490);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens on a quick upward flick that is short", () => {
    const { onOpen, at } = setup();
    at("pointerDown", 100, 500);
    now += 60;
    at("pointerMove", 100, 470);
    at("pointerUp", 100, 470);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("doesn't open on a slow short drag, or a tap", () => {
    const { onOpen, at } = setup();
    at("pointerDown", 100, 500);
    now += 50;
    at("pointerUp", 100, 500);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("resets on pointer cancel", () => {
    const { onOpen, card, at } = setup();
    at("pointerDown", 100, 500);
    now += 400;
    at("pointerMove", 100, 400);
    at("pointerCancel", 100, 400);
    expect(card.dataset.offset).toBe("0");
    expect(card.dataset.dragging).toBe("false");
    at("pointerUp", 100, 400);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clamps how far the card follows the finger", () => {
    const { card, at } = setup();
    at("pointerDown", 100, 700);
    now += 400;
    at("pointerMove", 100, 100);
    expect(Number(card.dataset.offset)).toBeGreaterThanOrEqual(-160);
    expect(Number(card.dataset.offset)).toBeLessThan(0);
  });

  it("keeps the pointer events from reaching what is under the card", () => {
    const { onParent, at } = setup();
    at("pointerDown", 100, 500);
    at("pointerMove", 100, 450);
    at("pointerUp", 100, 450);
    expect(onParent).not.toHaveBeenCalled();
  });

  it("sets touch-action none on what it is spread on", () => {
    const { card } = setup();
    expect(card.style.touchAction).toBe("none");
  });
});
