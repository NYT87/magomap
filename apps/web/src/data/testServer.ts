// A programmable stand-in for /api/sync/* used by the data tests.
import type { AnyRow, Mutation, PullResponse, PushResult, SyncTable } from "@magomap/domain";
import { ApiError, NetworkError, UnauthorizedError } from "../api/client";

export interface FakeServer {
  pushes: Mutation[][];
  /** Decide each mutation's result (default: applied). */
  result: (m: Mutation) => PushResult;
  /** Throw for a whole push (status code, or "network"). */
  failPush: ((ms: Mutation[]) => number | "network" | null) | null;
  pullPages: PullResponse[];
  pullStatus: number | null;
  fetch: <T>(path: string, init?: RequestInit) => Promise<T>;
}

export function fakeServer(): FakeServer {
  const server: FakeServer = {
    pushes: [],
    result: (m) => ({ mutationId: m.mutationId, status: "applied" }),
    failPush: null,
    pullPages: [],
    pullStatus: null,
    fetch: async <T>(path: string, init?: RequestInit): Promise<T> => {
      if (path === "/api/sync/push") {
        const { mutations } = JSON.parse(String(init?.body)) as { mutations: Mutation[] };
        const fail = server.failPush?.(mutations) ?? null;
        if (fail === "network") throw new NetworkError();
        if (fail === 401) throw new UnauthorizedError();
        if (fail !== null) throw new ApiError(fail, { error: "x" });
        server.pushes.push(mutations);
        return { results: mutations.map((m) => server.result(m)) } as T;
      }
      if (path.startsWith("/api/sync/pull")) {
        if (server.pullStatus === 401) throw new UnauthorizedError();
        const page = server.pullPages.shift() ?? { rows: [], cursor: "c-end", hasMore: false };
        return page as T;
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  return server;
}

export const pulled = (table: SyncTable, row: AnyRow) => ({ table, row });
