import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildInfo } from "@magomap/domain";

const SHORT = 7;

function gitCommit(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", `--short=${SHORT}`, "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * What this build is: the root package.json version, the commit (APP_COMMIT, else GITHUB_SHA, else
 * git, else "unknown", cut to 7) and when it was built (APP_BUILT_AT, else now).
 */
export function readBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const root = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"),
  ) as {
    version: string;
  };
  const given = env.APP_COMMIT || env.GITHUB_SHA;
  const commit = given ? given.slice(0, SHORT) : (gitCommit() ?? "unknown");
  return {
    version: root.version,
    commit,
    builtAt: env.APP_BUILT_AT || new Date().toISOString(),
  };
}
