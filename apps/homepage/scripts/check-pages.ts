// Checks the built homepage: every page has its Korean/English twin, internal links resolve,
// and every "Open magomap" link (data-app-link) goes to APP_URL.
//   tsx scripts/check-pages.ts dist        (APP_URL from the environment)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = "/magomap/";
export const DEFAULT_APP_URL = "http://localhost:8787/";

/** The app URL from the environment, trimmed (a stray space in a CI variable once reached the
 *  links), or the local default when it is unset or blank. */
export function appUrlOf(raw: string | undefined): string {
  return raw?.trim() || DEFAULT_APP_URL;
}

function htmlFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path, root);
    return name.endsWith(".html") ? [relative(root, path)] : [];
  });
}

// English is the default at the root; Korean lives under ko/.
const twinOf = (page: string) => (page.startsWith("ko/") ? page.slice(3) : `ko/${page}`);

/** Where an internal href lands in the built folder, or null for external links. */
function target(href: string): string | null {
  if (!href.startsWith(BASE)) return null;
  const path = href.slice(BASE.length).split(/[?#]/)[0] ?? "";
  if (path === "" || path.endsWith("/")) return `${path}index.html`;
  return path.endsWith(".html") ? path : path;
}

export function checkPages(dir: string, appUrl: string): string[] {
  const problems: string[] = [];
  if (appUrl !== appUrl.trim()) problems.push(`the app URL '${appUrl}' has spaces around it`);
  const pages = htmlFiles(dir).filter((p) => !p.startsWith("assets/"));
  for (const page of pages) {
    if (!pages.includes(twinOf(page))) {
      problems.push(
        page.startsWith("ko/")
          ? `${page} has no English twin (${twinOf(page)})`
          : `${page} has no Korean twin (${twinOf(page)})`,
      );
    }
    const html = readFileSync(join(dir, page), "utf8");
    for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
      const attrs = m[1] ?? "";
      const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? "";
      if (/\bdata-app-link\b/.test(attrs)) {
        if (href !== appUrl) {
          problems.push(`${page}: an 'Open magomap' link goes to ${href}, not ${appUrl}`);
        }
        continue;
      }
      const to = target(href);
      if (to !== null && !existsSync(join(dir, to))) {
        problems.push(`${page} links to a missing page: ${href}`);
      }
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "dist";
  const appUrl = appUrlOf(process.env.APP_URL);
  const problems = checkPages(dir, appUrl);
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(`✓ ${dir}: pages are paired and links resolve`);
}
