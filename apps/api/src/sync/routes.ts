import { applyPush, pull } from "@magomap/db/stores/sync";
import { LIMITS, type Mutation, pushEnvelopeSchema } from "@magomap/domain";
import { Hono } from "hono";
import { requireUser } from "../auth/session";
import type { AppEnv } from "../env";

export const syncRoutes = new Hono<AppEnv>();

syncRoutes.use("/sync/*", requireUser);

syncRoutes.post("/sync/push", async (c) => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > LIMITS.pushBytes) return c.json({ error: "too_large" }, 413);
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > LIMITS.pushBytes) {
    return c.json({ error: "too_large" }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid" }, 400);
  }
  const envelope = pushEnvelopeSchema.safeParse(body);
  if (!envelope.success) return c.json({ error: "invalid" }, 400);
  const result = await applyPush(
    c.var.db,
    c.var.userId,
    envelope.data.mutations as Mutation[],
    Date.now(),
  );
  return c.json(result);
});

syncRoutes.get("/sync/pull", async (c) => {
  return c.json(await pull(c.var.db, c.var.userId, c.req.query("cursor") ?? null));
});
