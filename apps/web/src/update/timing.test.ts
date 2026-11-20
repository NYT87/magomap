import { describe, expect, it } from "vitest";
import { dueForCheck, onUpdateFound } from "./timing";

describe("update timing", () => {
  it("applies inside the cold-start window", () => {
    expect(onUpdateFound(0)).toBe("apply");
    expect(onUpdateFound(2999)).toBe("apply");
  });
  it("prompts after it", () => {
    expect(onUpdateFound(3000)).toBe("prompt");
    expect(onUpdateFound(10_000)).toBe("prompt");
  });
  it("checks every 30 minutes", () => {
    const t = 1_000_000;
    expect(dueForCheck(t + 29 * 60_000, t)).toBe(false);
    expect(dueForCheck(t + 30 * 60_000, t)).toBe(true);
  });
});
