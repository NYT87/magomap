import {
  completeImportRun,
  finishImportList,
  importListChunk,
  latestImportRun,
  RunClosedError,
  RunNotFoundError,
  startImportRun,
} from "@magomap/db/stores/importRuns";
import { importItemsChunkSchema, importListMetaSchema } from "@magomap/domain";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppEnv } from "../env";

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("/import/*", requireUser);

async function kakaoIdentity(c: Context<AppEnv>): Promise<string | null> {
  const row = await c.var.db.kysely
    .selectFrom("identities")
    .select("provider_user_id")
    .where("user_id", "=", c.var.userId)
    .where("provider", "=", "kakao")
    .executeTakeFirst();
  return row?.provider_user_id ?? null;
}

/** Runs a store call, mapping run errors to 404 / 409. */
async function onRun<T>(c: Context<AppEnv>, fn: () => Promise<T>) {
  try {
    return c.json(await fn());
  } catch (error) {
    if (error instanceof RunNotFoundError) return c.json({ error: "not_found" }, 404);
    if (error instanceof RunClosedError) return c.json({ error: "run_closed" }, 409);
    throw error;
  }
}

importRoutes.get("/import/kakao/source", async (c) => {
  const kakaoUserId = await kakaoIdentity(c);
  if (!kakaoUserId) return c.json({ error: "no_snapshot" }, 404);
  const url = new URL("/api/integrations/magomap/snapshot", c.env.KAKAO_LIST_URL);
  url.searchParams.set("kakaoUserId", kakaoUserId);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { authorization: `Bearer ${c.env.MAGOMAP_IMPORT_SECRET}` },
    });
  } catch {
    return c.json({ error: "kakao_list_unavailable" }, 502);
  }
  if (upstream.status === 200) {
    // Stream the body through without parsing it (CPU budget).
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (upstream.status === 404) {
    const body = (await upstream.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === "no_snapshot") return c.json({ error: "no_snapshot" }, 404);
  }
  return c.json({ error: "kakao_list_unavailable" }, 502);
});

importRoutes.post("/import/runs", async (c) => {
  const body = z
    .object({ complete: z.boolean(), importedAt: z.string().min(1).max(40) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await startImportRun(c.var.db, c.var.userId, body.data, Date.now()));
});

const folderParam = (c: Context<AppEnv>) => {
  const n = Number(c.req.param("kakaoFolderId"));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

importRoutes.put("/import/runs/:runId/lists/:kakaoFolderId/chunks/:index", async (c) => {
  const folder = folderParam(c);
  const raw = (await c.req.json().catch(() => null)) as { meta?: unknown; items?: unknown } | null;
  const meta = importListMetaSchema.safeParse(raw?.meta);
  const items = importItemsChunkSchema.safeParse(raw?.items);
  if (folder === null || !meta.success || !items.success || meta.data.kakaoFolderId !== folder) {
    return c.json({ error: "invalid" }, 400);
  }
  return onRun(c, () =>
    importListChunk(
      c.var.db,
      c.var.userId,
      c.req.param("runId"),
      meta.data,
      items.data,
      Date.now(),
    ),
  );
});

importRoutes.post("/import/runs/:runId/lists/:kakaoFolderId/finish", async (c) => {
  const folder = folderParam(c);
  if (folder === null) return c.json({ error: "invalid" }, 400);
  return onRun(c, () =>
    finishImportList(c.var.db, c.var.userId, c.req.param("runId"), folder, Date.now()),
  );
});

importRoutes.post("/import/runs/:runId/complete", async (c) => {
  const body = z
    .object({ kakaoFolderIds: z.array(z.number().int().nonnegative()).max(500) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return onRun(c, () =>
    completeImportRun(
      c.var.db,
      c.var.userId,
      c.req.param("runId"),
      body.data.kakaoFolderIds,
      Date.now(),
    ),
  );
});

importRoutes.get("/import/runs/latest", async (c) =>
  c.json(await latestImportRun(c.var.db, c.var.userId)),
);
