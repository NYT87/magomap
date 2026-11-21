import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
let outDir: string;

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  key?: string;
  background?: { service_worker?: string; type?: string };
  permissions?: string[];
  host_permissions?: string[];
  externally_connectable?: { matches?: string[] };
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "magomap-extension-"));
  await build({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir },
  });
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("the built extension", () => {
  it("has a valid MV3 manifest whose files exist", () => {
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as Manifest;
    const source = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Manifest;
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

    expect(manifest).toEqual(source);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("magomap");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.permissions).toEqual(["scripting", "tabs"]);
    expect(manifest.host_permissions).toEqual(["https://map.kakao.com/*"]);
    expect(manifest.externally_connectable?.matches).toEqual([
      "https://magomap.jmn8718.workers.dev/*",
      "http://localhost:5173/*",
      "http://localhost:8787/*",
    ]);
    expect(manifest.background?.type).toBe("module");
    const worker = manifest.background?.service_worker ?? "";
    expect(worker).not.toBe("");
    expect(existsSync(join(outDir, worker))).toBe(true);
  });

  it("the service worker is one self-contained file that never logs", () => {
    const worker = readFileSync(join(outDir, "background.js"), "utf8");

    expect(worker).not.toMatch(/^\s*import\s/m);
    expect(worker).toContain("onMessageExternal");
    expect(worker).not.toMatch(/console\./);
  });
});
