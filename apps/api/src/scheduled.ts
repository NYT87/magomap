import { closeAbandonedImportRuns } from "@magomap/db/stores/importRuns";
import { openDb } from "./db";
import type { Env } from "./env";

/**
 * The daily clean-up (a Cron Trigger, see wrangler.toml): closes import runs left running for
 * a week and deletes their pages. Returns how many runs it closed.
 * https://developers.cloudflare.com/workers/configuration/cron-triggers/
 */
export async function dailyCleanUp(env: Env, now: number = Date.now()): Promise<number> {
  const { db, perRequest } = openDb(env);
  try {
    return await closeAbandonedImportRuns(db, now);
  } finally {
    if (perRequest) await db.close();
  }
}

export function scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(
    dailyCleanUp(env).then((closed) => {
      // A count only, never what the runs held.
      console.log(`Closed ${closed} abandoned import run(s).`);
    }),
  );
}
