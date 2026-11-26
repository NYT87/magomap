// The import routes every run shares: finish a list, complete the run, the latest run. The Kakao
// Map sync (kakaoMapRoutes.ts) starts its runs and sends their pages; runs the old kakao-list
// import left in the database are read and closed the same way.
import {
  completeImportRun,
  finishImportList,
  ImportConflictError,
  ImportIncompleteError,
  latestImportRun,
  RunClosedError,
  RunNotFoundError,
} from "@magomap/db/stores/importRuns";
import { LIMITS } from "@magomap/domain";
import { type Context, Hono } from "hono";
import { requireUser } from "../auth/session";
import type { AppEnv } from "../env";

export const importRoutes = new Hono<AppEnv>();
// The run routes only: /import/kakao-map/* has its own check (kakaoMapRoutes), and both apps
// are mounted at "/", so "/import/*" here would read the session a second time on those.
importRoutes.use("/import/runs/*", requireUser);

export const PAGE = LIMITS.importChunkItems;

/** The caller's Kakao Login id, or undefined when they have no Kakao identity. */
export async function kakaoLoginIdOf(c: Context<AppEnv>): Promise<string | undefined> {
  const row = await c.var.db.kysely
    .selectFrom("identities")
    .select("provider_user_id")
    .where("user_id", "=", c.var.userId)
    .where("provider", "=", "kakao")
    .executeTakeFirst();
  return row?.provider_user_id;
}

/** Handles the errors every import route shares; route-specific ones are caught first. */
export async function handled<T>(c: Context<AppEnv>, fn: () => Promise<T>) {
  try {
    return c.json(await fn());
  } catch (error) {
    if (error instanceof RunNotFoundError) return c.json({ error: "not_found" }, 404);
    if (error instanceof RunClosedError) return c.json({ error: "run_closed" }, 409);
    if (error instanceof ImportConflictError) return c.json({ error: "list_conflict" }, 409);
    if (error instanceof ImportIncompleteError) return c.json({ error: "incomplete" }, 409);
    throw error;
  }
}

importRoutes.post("/import/runs/:runId/lists/:externalId/finish", (c) =>
  handled(c, () =>
    finishImportList(
      c.var.db,
      c.var.userId,
      c.req.param("runId"),
      c.req.param("externalId"),
      Date.now(),
    ),
  ),
);

importRoutes.post("/import/runs/:runId/complete", (c) =>
  handled(c, () => completeImportRun(c.var.db, c.var.userId, c.req.param("runId"), Date.now())),
);

importRoutes.get("/import/runs/latest", async (c) =>
  c.json(await latestImportRun(c.var.db, c.var.userId)),
);
