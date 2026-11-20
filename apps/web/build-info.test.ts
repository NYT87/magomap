import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readBuildInfo } from "./build-info";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

beforeEach(() => {
  vi.mocked(execFileSync).mockReset();
});

describe("readBuildInfo", () => {
  it("prefers APP_COMMIT, then GITHUB_SHA, cut to 7", () => {
    expect(readBuildInfo({ APP_COMMIT: "a1b2c3d4e5f6", GITHUB_SHA: "ffffffffff" }).commit).toBe(
      "a1b2c3d",
    );
    expect(readBuildInfo({ GITHUB_SHA: "0123456789abcdef" }).commit).toBe("0123456");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('falls back to git, then "unknown"', () => {
    vi.mocked(execFileSync).mockReturnValueOnce("9f8e7d6\n");
    expect(readBuildInfo({}).commit).toBe("9f8e7d6");
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });
    expect(readBuildInfo({}).commit).toBe("unknown");
  });

  it("uses APP_BUILT_AT when set", () => {
    expect(readBuildInfo({ APP_BUILT_AT: "2026-11-20T08:30:00.000Z" }).builtAt).toBe(
      "2026-11-20T08:30:00.000Z",
    );
    const own = readBuildInfo({ APP_COMMIT: "abcdef0" }).builtAt;
    expect(new Date(own ?? "").toISOString()).toBe(own);
  });

  it("reads the root package version", () => {
    const root = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"));
    expect(root.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(readBuildInfo({ APP_COMMIT: "abcdef0" }).version).toBe(root.version);
  });
});
