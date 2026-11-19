import { WriteConflictError } from "@magomap/db/stores/sync";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/errors";

describe("errorResponse", () => {
  it("turns a write conflict into a retryable 503", () => {
    expect(errorResponse(new WriteConflictError())).toEqual({
      status: 503,
      body: { error: "busy" },
    });
  });

  it("leaves other errors alone", () => {
    expect(errorResponse(new Error("boom"))).toBeNull();
  });
});
