import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBundle, entryScripts, INITIAL_JS_BUDGET } from "./check-bundle.mjs";

function site(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "mm-bundle-"));
  mkdirSync(join(dir, "assets"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

/** Text that gzip can't shrink much: random bytes as base64 (about 3/4 of its length). */
const noise = (bytes: number) => randomBytes(bytes).toString("base64");

describe("check-bundle", () => {
  it("finds the entry scripts the page loads first", () => {
    expect(
      entryScripts(
        '<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="modulepreload" href="/assets/vendor-B.js">',
      ),
    ).toEqual(["/assets/index-A.js", "/assets/vendor-B.js"]);
  });

  it("has a 200 kB gzip budget for the first JavaScript", () => {
    expect(INITIAL_JS_BUDGET).toBe(200_000);
  });

  it("passes a small entry and counts its gzip size", () => {
    const dir = site({
      "index.html": '<script type="module" src="/assets/index-A.js"></script>',
      "assets/index-A.js": "console.log(1);".repeat(100),
    });
    const result = checkBundle(dir);
    expect(result.problems).toEqual([]);
    expect(result.gzipBytes).toBeGreaterThan(0);
    expect(result.gzipBytes).toBeLessThan(200);
  });

  it("fails an entry over the budget, naming its size", () => {
    const dir = site({
      "index.html": '<script type="module" src="/assets/index-A.js"></script>',
      "assets/index-A.js": noise(320_000),
    });
    const { problems } = checkBundle(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/first JavaScript is \d+ bytes gzip, over the 200000 byte budget/);
  });

  it("fails a page with no entry script", () => {
    const dir = site({ "index.html": "<p>no script</p>" });
    expect(checkBundle(dir).problems).toEqual(["index.html loads no script"]);
  });
});

describe("cache headers for the built app", () => {
  const rules = () => readFileSync(join(process.cwd(), "public/_headers"), "utf8");

  it("caches the content-hashed files in /assets/ for a year, as immutable", () => {
    expect(rules()).toMatch(
      /^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m,
    );
  });

  it("never makes the page, the service worker or the manifest long-lived", () => {
    expect(rules()).not.toMatch(/index\.html|sw\.js|manifest|^\/\*$/m);
  });
});
