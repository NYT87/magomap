import type { PublicConfig } from "@magomap/domain";
import { Hono } from "hono";
import { sql } from "kysely";
import { authRoutes } from "./auth/routes";
import { withDb } from "./db";
import type { AppEnv } from "./env";
import { importRoutes } from "./import/routes";
import { syncRoutes } from "./sync/routes";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", withDb);

app.get("/health", async (c) => {
  await sql`SELECT 1`.execute(c.var.db.kysely);
  return c.json({ ok: true, db: c.env.DB_DRIVER });
});

app.get("/config", (c) => {
  const config: PublicConfig = {
    kakaoJavascriptKey: c.env.KAKAO_JAVASCRIPT_KEY || null,
    devLoginEnabled: c.env.ALLOW_DEV_LOGIN === "true",
  };
  return c.json(config);
});

app.route("/", authRoutes);
app.route("/", syncRoutes);
app.route("/", importRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
