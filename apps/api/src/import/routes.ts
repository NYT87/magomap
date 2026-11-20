// The server-driven import: the Worker fetches the caller's own provider data from kakao-list,
// one list summary call and one ≤500-item page per request. The app only says "next page";
// it never supplies import data, so it can't change shared lists or places.
import {
  completeImportRun,
  finishImportList,
  ImportConflictError,
  ImportIncompleteError,
  importedSnapshot,
  importListChunk,
  latestImportRun,
  RunClosedError,
  RunNotFoundError,
  runProgress,
  runSnapshot,
  startImportRun,
} from "@magomap/db/stores/importRuns";
import { LIMITS } from "@magomap/domain";
import {
  KAKAO,
  kakaoFolderIdOf,
  kakaoItemsToImport,
  kakaoListsToImport,
} from "@magomap/domain/providers/kakao";
import { type Context, Hono } from "hono";
import { requireUser } from "../auth/session";
import type { AppEnv } from "../env";

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("/import/*", requireUser);

const PAGE = LIMITS.importChunkItems;

class SnapshotChangedError extends Error {}

class UpToDateError extends Error {}

class UpstreamError extends Error {
  constructor(readonly code: "no_snapshot" | "kakao_list_unavailable") {
    super(code);
  }
}

async function kakaoIdentity(c: Context<AppEnv>): Promise<string> {
  const row = await c.var.db.kysely
    .selectFrom("identities")
    .select("provider_user_id")
    .where("user_id", "=", c.var.userId)
    .where("provider", "=", "kakao")
    .executeTakeFirst();
  if (!row) throw new UpstreamError("no_snapshot");
  return row.provider_user_id;
}

/** GET from kakao-list for the caller's own Kakao id; never follows redirects (the secret stays put). */
async function fromKakaoList(
  c: Context<AppEnv>,
  kakaoUserId: string,
  path: string,
  query: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`/api/integrations/magomap${path}`, c.env.KAKAO_LIST_URL);
  url.searchParams.set("kakaoUserId", kakaoUserId);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${c.env.MAGOMAP_IMPORT_SECRET}` },
      redirect: "manual",
    });
  } catch {
    throw new UpstreamError("kakao_list_unavailable");
  }
  if (res.status === 200) {
    try {
      return await res.json();
    } catch {
      throw new UpstreamError("kakao_list_unavailable");
    }
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === "no_snapshot") throw new UpstreamError("no_snapshot");
  }
  throw new UpstreamError("kakao_list_unavailable");
}

async function handled<T>(c: Context<AppEnv>, fn: () => Promise<T>) {
  try {
    return c.json(await fn());
  } catch (error) {
    if (error instanceof UpstreamError) {
      return error.code === "no_snapshot"
        ? c.json({ error: "no_snapshot" }, 404)
        : c.json({ error: "kakao_list_unavailable" }, 502);
    }
    if (error instanceof RunNotFoundError) return c.json({ error: "not_found" }, 404);
    if (error instanceof RunClosedError) return c.json({ error: "run_closed" }, 409);
    if (error instanceof ImportConflictError) return c.json({ error: "list_conflict" }, 409);
    if (error instanceof SnapshotChangedError) return c.json({ error: "snapshot_changed" }, 409);
    if (error instanceof UpToDateError) return c.json({ error: "up_to_date" }, 409);
    if (error instanceof ImportIncompleteError) return c.json({ error: "incomplete" }, 409);
    throw error;
  }
}

importRoutes.post("/import/runs", (c) =>
  handled(c, async () => {
    let snapshot: ReturnType<typeof kakaoListsToImport>;
    try {
      const kakaoUserId = await kakaoIdentity(c);
      snapshot = kakaoListsToImport(await fromKakaoList(c, kakaoUserId, "/lists"), kakaoUserId);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError("kakao_list_unavailable");
    }
    // Checked before startImportRun so refusing doesn't supersede an open run.
    if (await importedSnapshot(c.var.db, c.var.userId, Date.parse(snapshot.importedAt)))
      throw new UpToDateError();
    let started: { runId: string };
    try {
      started = await startImportRun(
        c.var.db,
        c.var.userId,
        { ...snapshot, provider: KAKAO, lists: snapshot.lists },
        Date.now(),
      );
    } catch (error) {
      // A snapshot dated in the future (or unreadable) is kakao-list's problem, not the user's.
      if (error instanceof Error && error.message === "Invalid importedAt")
        throw new UpstreamError("kakao_list_unavailable");
      throw error;
    }
    return {
      runId: started.runId,
      lists: snapshot.lists.map((l) => ({
        externalId: l.externalId,
        name: l.name,
        itemCount: l.itemCount,
      })),
    };
  }),
);

/** kakao-list's current sync for the caller; every failure becomes an UpstreamError. */
async function currentSnapshot(c: Context<AppEnv>): Promise<ReturnType<typeof kakaoListsToImport>> {
  try {
    const kakaoUserId = await kakaoIdentity(c);
    return kakaoListsToImport(await fromKakaoList(c, kakaoUserId, "/lists"), kakaoUserId);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError("kakao_list_unavailable");
  }
}

importRoutes.get("/import/status", async (c) => {
  const latest = await latestImportRun(c.var.db, c.var.userId);
  let sourceSnapshotAt: number | null = null;
  try {
    sourceSnapshotAt = Date.parse((await currentSnapshot(c)).importedAt);
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
  }
  const upToDate =
    sourceSnapshotAt !== null && (await importedSnapshot(c.var.db, c.var.userId, sourceSnapshotAt));
  return c.json({ latest, sourceSnapshotAt, upToDate });
});

importRoutes.post("/import/runs/:runId/resume", (c) =>
  handled(c, async () => {
    const run = await runProgress(c.var.db, c.var.userId, c.req.param("runId"));
    const snapshot = await currentSnapshot(c);
    if (Date.parse(snapshot.importedAt) !== run.snapshotAt) throw new SnapshotChangedError();
    return { runId: c.req.param("runId"), lists: run.lists };
  }),
);

importRoutes.post("/import/runs/:runId/lists/:externalId/pages/:index", (c) =>
  handled(c, async () => {
    const runId = c.req.param("runId");
    const externalId = c.req.param("externalId");
    const index = Number(c.req.param("index"));
    const run = await runSnapshot(c.var.db, c.var.userId, runId);
    const meta = run.lists.find((l) => l.externalId === externalId);
    const pages = Math.max(1, Math.ceil((meta?.itemCount ?? 0) / PAGE));
    if (!meta || !Number.isSafeInteger(index) || index < 0 || index >= pages)
      throw new RunNotFoundError();
    // kakao-list knows the list by its Kakao folder id (folder 0 is "0~<user>" here).
    const folderId = kakaoFolderIdOf(externalId);
    if (folderId === undefined) throw new RunNotFoundError();
    let page: ReturnType<typeof kakaoItemsToImport>;
    try {
      const kakaoUserId = await kakaoIdentity(c);
      page = kakaoItemsToImport(
        await fromKakaoList(c, kakaoUserId, `/lists/${folderId}/items`, {
          offset: String(index * PAGE),
          limit: String(PAGE),
        }),
        kakaoUserId,
      );
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError("kakao_list_unavailable");
    }
    if (
      Date.parse(page.importedAt) !== run.snapshotAt ||
      page.externalId !== externalId ||
      page.total !== meta.itemCount
    ) {
      // kakao-list was re-imported since this run started: restart the import.
      throw new SnapshotChangedError();
    }
    // Exactly the page asked for, so a finished list really had every item.
    const offset = index * PAGE;
    if (page.offset !== offset || page.items.length !== Math.min(PAGE, page.total - offset)) {
      throw new UpstreamError("kakao_list_unavailable");
    }
    const summary = await importListChunk(
      c.var.db,
      c.var.userId,
      runId,
      externalId,
      index,
      page.items,
      Date.now(),
    );
    return { ...summary, done: index + 1 >= pages };
  }),
);

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
