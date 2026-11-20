import type { BuildInfo } from "@magomap/domain";
import { useEffect, useState } from "react";

/** The build this code came from, stamped in by Vite. */
export const APP_BUILD: BuildInfo = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: __APP_BUILT_AT__ || null,
};

export type ServerBuild =
  | { state: "loading" }
  | { state: "offline" }
  | { state: "ok"; build: BuildInfo };

function isBuild(x: unknown): x is BuildInfo {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    typeof b.version === "string" &&
    typeof b.commit === "string" &&
    (typeof b.builtAt === "string" || b.builtAt === null)
  );
}

/** The server's build, asked fresh from /api/health (never a cached answer); asked again on coming back online. */
export function useServerBuild(): ServerBuild {
  const [state, setState] = useState<ServerBuild>({ state: "loading" });

  useEffect(() => {
    let live = true;
    let controller: AbortController | null = null;
    const ask = async () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: mine.signal });
        const body: unknown = await res.json();
        if (!res.ok || !isBuild(body)) throw new Error("no build info");
        const { version, commit, builtAt } = body;
        if (live && !mine.signal.aborted) {
          setState({ state: "ok", build: { version, commit, builtAt } });
        }
      } catch {
        if (live && !mine.signal.aborted) setState({ state: "offline" });
      }
    };
    void ask();
    window.addEventListener("online", ask);
    return () => {
      live = false;
      controller?.abort();
      window.removeEventListener("online", ask);
    };
  }, []);

  return state;
}
