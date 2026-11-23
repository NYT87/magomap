import { describe, expect, it, vi } from "vitest";
import { applyFocus } from "./applyFocus";

const adapter = () => ({ panTo: vi.fn(), fitTo: vi.fn() });
const point = { lat: 33.4, lng: 126.5 };

describe("applyFocus", () => {
  it("opening a place only centres it, keeping the zoom", () => {
    const a = adapter();
    applyFocus(a, point);
    expect(a.panTo).toHaveBeenCalledWith(point);
    expect(a.fitTo).not.toHaveBeenCalled();
  });

  it("a search result that isn't saved is brought close", () => {
    const a = adapter();
    applyFocus(a, { ...point, close: true });
    expect(a.fitTo).toHaveBeenCalledWith([point]);
    expect(a.panTo).not.toHaveBeenCalled();
  });
});
