import { describe, expect, it } from "vitest";
import { decodeId } from "./decodeId";

describe("decodeId", () => {
  it("decodes percent-encoding", () => expect(decodeId("a%3Ab")).toBe("a:b"));
  it("returns the raw id when it is malformed", () =>
    expect(decodeId("%E0%A4%A")).toBe("%E0%A4%A"));
  it("passes undefined through", () => expect(decodeId(undefined)).toBeUndefined());
});
