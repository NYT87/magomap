// Fails the build when the JavaScript the page loads first is over budget (gzip), so a static
// import that drags a big library into the entry can't slip through again (docs/perf-audit.md).
//   node scripts/check-bundle.mjs dist
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Bytes of gzip (level 9) the first JavaScript may take: the phone budget in docs/perf-audit.md. */
export const INITIAL_JS_BUDGET = 200_000;

/** The scripts index.html loads up front: its module script and any modulepreloads. */
export function entryScripts(html) {
  const found = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)) found.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)) {
    found.push(m[1]);
  }
  return found;
}

export function checkBundle(dir, budget = INITIAL_JS_BUDGET) {
  const scripts = entryScripts(readFileSync(join(dir, "index.html"), "utf8"));
  if (scripts.length === 0) return { gzipBytes: 0, problems: ["index.html loads no script"] };
  const gzipBytes = scripts
    .map((src) => gzipSync(readFileSync(join(dir, src.replace(/^\//, ""))), { level: 9 }).length)
    .reduce((a, b) => a + b, 0);
  const problems =
    gzipBytes > budget
      ? [`the first JavaScript is ${gzipBytes} bytes gzip, over the ${budget} byte budget`]
      : [];
  return { gzipBytes, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "dist";
  const { gzipBytes, problems } = checkBundle(dir);
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(`✓ ${dir}: first JavaScript ${gzipBytes} bytes gzip (budget ${INITIAL_JS_BUDGET})`);
}
