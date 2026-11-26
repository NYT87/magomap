import { describe, expect, it, vi } from "vitest";

const ask = vi.fn<(message: unknown, timeoutMs: number) => Promise<unknown>>();
vi.mock("../import/kakaoMap", () => ({
  askExtension: (m: unknown, t: number) => ask(m, t),
}));
const { extensionTooOld } = await import("./kakaoEditCheck");

describe("extensionTooOld", () => {
  it.each([
    ["0.1.4", true],
    ["0.1.0", true],
    ["0.0.9", true],
    ["0.1", true],
    ["0.1.5", false],
    ["0.1.10", false],
    ["0.2.0", false],
    ["1.0", false],
    ["0.1.5.1", false],
  ])("version %s is too old: %s", async (version, old) => {
    ask.mockResolvedValueOnce({ ok: true, version });
    expect(await extensionTooOld()).toBe(old);
  });

  it.each([
    ["no version", { ok: true }],
    ["a version that isn't text", { ok: true, version: 15 }],
    ["a version that isn't numbers", { ok: true, version: "dev" }],
    ["no answer", undefined],
  ])(
    "doesn't judge an extension with %s (the account check says what's wrong)",
    async (_, answer) => {
      ask.mockResolvedValueOnce(answer);
      expect(await extensionTooOld()).toBe(false);
    },
  );
});
