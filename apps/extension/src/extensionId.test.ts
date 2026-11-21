import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID } from "./extensionId";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Chrome's id: sha256 of the DER public key, first 32 hex digits, 0-f written as a-p. */
function idFromKey(base64Key: string): string {
  const hex = createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("hex");
  return [...hex.slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join("");
}

describe("extension id", () => {
  const manifest = JSON.parse(read("../manifest.json")) as { key?: string };

  it("manifest.json carries a public key and no private one", () => {
    expect(manifest.key).toMatch(/^MII[A-Za-z0-9+/]+=*$/);
    expect(read("../manifest.json")).not.toMatch(/PRIVATE/);
  });

  it("the id recomputed from manifest.json's key matches the constant and the README", () => {
    const id = idFromKey(manifest.key ?? "");

    expect(id).toBe(EXTENSION_ID);
    expect(read("../README.md")).toContain(id);
  });
});
