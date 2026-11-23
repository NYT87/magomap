import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { allowedOrigins, connectableMatches } from "./origins";
import type { ReadResult } from "./readInPage";

const root = fileURLToPath(new URL("..", import.meta.url));
const tempDirs: string[] = [];

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  key?: string;
  icons?: Record<string, string>;
  action?: { default_icon?: Record<string, string> };
  background?: { service_worker?: string; type?: string };
  permissions?: string[];
  host_permissions?: string[];
  externally_connectable?: { matches?: string[] };
}

interface Built {
  manifest: Manifest;
  worker: string;
  outDir: string;
}

async function buildInto(mode: "production" | "development"): Promise<Built> {
  const outDir = mkdtempSync(join(tmpdir(), `magomap-extension-${mode}-`));
  tempDirs.push(outDir);
  await build({
    root,
    mode,
    configFile: join(root, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir },
  });
  return {
    outDir,
    manifest: JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as Manifest,
    worker: readFileSync(join(outDir, "background.js"), "utf8"),
  };
}

/** The origin strings inside the built worker's ALLOWED_ORIGINS. */
function originsIn(worker: string): string[] {
  return [...worker.matchAll(/["'](https?:\/\/[^"'/]+)["']/g)]
    .map((match) => match[1] ?? "")
    .filter((origin) => !origin.includes("kakao.com"));
}

const builds: Partial<Record<"release" | "dev", Built>> = {};
const release = () => builds.release as Built;
const dev = () => builds.dev as Built;

beforeAll(async () => {
  builds.release = await buildInto("production");
  builds.dev = await buildInto("development");
}, 120_000);

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the built extension", () => {
  const source = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Manifest;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

  for (const [name, get, isDev] of [
    ["release", release, false],
    ["dev", dev, true],
  ] as const) {
    it(`${name}: has a valid MV3 manifest whose files exist`, () => {
      const { manifest, outDir } = get();

      expect(manifest).toEqual({
        ...source,
        externally_connectable: { matches: connectableMatches(isDev) },
      });
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe("magomap");
      expect(manifest.version).toBe(pkg.version);
      expect(manifest.key).toBe(source.key);
      expect(manifest.permissions).toEqual(["scripting"]);
      expect(manifest.host_permissions).toEqual(["https://map.kakao.com/*"]);
      expect(manifest.background?.type).toBe("module");
      const worker = manifest.background?.service_worker ?? "";
      expect(worker).not.toBe("");
      expect(existsSync(join(outDir, worker))).toBe(true);
      const icons = [
        ...Object.values(manifest.icons ?? {}),
        ...Object.values(manifest.action?.default_icon ?? {}),
      ];
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) expect(existsSync(join(outDir, icon))).toBe(true);
    });

    it(`${name}: ALLOWED_ORIGINS matches externally_connectable`, () => {
      const { manifest, worker } = get();

      expect(originsIn(worker)).toEqual(allowedOrigins(isDev));
      expect(manifest.externally_connectable?.matches).toEqual(
        originsIn(worker).map((origin) => `${origin}/*`),
      );
    });

    it(`${name}: the service worker is one self-contained file that never logs`, () => {
      const { worker } = get();

      expect(worker).not.toMatch(/^\s*import\s/m);
      expect(worker).toContain("onMessageExternal");
      expect(worker).not.toMatch(/console\./);
    });
  }

  it("release: only production magomap may connect, nothing over http:", () => {
    const { manifest, worker } = release();

    expect(manifest.externally_connectable?.matches).toEqual([
      "https://magomap.jmn8718.workers.dev/*",
    ]);
    expect(manifest.externally_connectable?.matches?.some((m) => m.startsWith("http:"))).toBe(
      false,
    );
    expect(originsIn(worker).some((origin) => origin.startsWith("http:"))).toBe(false);
    expect(worker).not.toContain("localhost");
  });

  it("dev: the local dev servers may connect too", () => {
    expect(dev().manifest.externally_connectable?.matches).toEqual([
      "https://magomap.jmn8718.workers.dev/*",
      "http://localhost:5173/*",
      "http://localhost:8787/*",
    ]);
  });

  it("release: the shipped readInPage is self-contained and reads", async () => {
    const { worker } = release();
    // The bundle marks each module with a `// src/<file>` comment. Take readInPage's
    // module alone and rebuild it away from the rest of the bundle, as
    // chrome.scripting.executeScript does with `func`.
    const start = worker.indexOf("// src/readInPage.ts");
    const end = worker.indexOf("// src/", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const moduleText = worker.slice(start, end);
    expect(moduleText).toContain("async function readInPage()");
    const shipped = new Function(
      `${moduleText}\nreturn readInPage;`,
    )() as () => Promise<ReadResult>;
    // Serialise once more, exactly as Chrome does, so only the function's own text is left.
    const injected = new Function(`return (${shipped.toString()});`)() as typeof shipped;

    vi.stubGlobal("window", { location: { origin: "https://map.kakao.com" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        const body =
          url.pathname === "/folder/list"
            ? { status: { code: "SUCCESS" }, folders: [{ folderid: 0 }] }
            : { status: { code: "SUCCESS" }, favorites: [{ seq: 1, lat: 33.4, lon: 126.9 }] };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    expect(await injected()).toEqual({
      ok: true,
      start: { folders: [{ folderid: 0 }], counts: [{ folderid: 0, itemCount: 1 }] },
      favorites: { "0": [{ seq: 1, lat: 33.4, lon: 126.9 }] },
    });
  });

  it("release: the shipped writeInPage is self-contained and writes", async () => {
    const { worker } = release();
    const start = worker.indexOf("// src/writeList.ts");
    const end = worker.indexOf("// src/", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const moduleText = end > start ? worker.slice(start, end) : worker.slice(start);
    expect(moduleText).toContain("async function writeInPage(");
    const shipped = new Function(`${moduleText}\nreturn writeInPage;`)() as (
      request: unknown,
    ) => Promise<unknown>;
    // Serialised once more, exactly as Chrome does, so only the function's own text is left.
    const injected = new Function(`return (${shipped.toString()});`)() as typeof shipped;

    const seen: { path: string; method: string; body?: string }[] = [];
    vi.stubGlobal("window", { location: { origin: "https://map.kakao.com" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        seen.push({
          path: new URL(input).pathname,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response(
          JSON.stringify({ status: { code: "SUCCESS" }, req: { folderid: 25038639 } }),
          { status: 200 },
        );
      }),
    );

    expect(await injected({ op: "create", name: "제주 (복사본)" })).toEqual({
      ok: true,
      folderId: 25038639,
    });
    expect(seen).toEqual([
      {
        path: "/folder/add",
        method: "POST",
        body: JSON.stringify({
          title: "제주 (복사본)",
          memo: "",
          out_link: "",
          icon: 10,
          status: "P",
        }),
      },
    ]);
  });
});
