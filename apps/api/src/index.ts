import type { BuildInfo, PublicConfig } from "@magomap/domain";
import { Hono } from "hono";
import { sql } from "kysely";
import { authRoutes } from "./auth/routes";
import { withDb } from "./db";
import type { AppEnv } from "./env";
import { errorResponse } from "./errors";
import { kakaoMapRoutes } from "./import/kakaoMapRoutes";
import { importRoutes } from "./import/routes";
import { searchRoutes } from "./search/routes";
import { syncRoutes } from "./sync/routes";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", withDb);

app.get("/health", async (c) => {
  await sql`SELECT 1`.execute(c.var.db.kysely);
  const build: BuildInfo = {
    version: c.env.APP_VERSION || "dev",
    commit: c.env.APP_COMMIT || "unknown",
    builtAt: c.env.APP_BUILT_AT || null,
  };
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, db: c.env.DB_DRIVER, ...build });
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
app.route("/", kakaoMapRoutes);
app.route("/", searchRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  const known = errorResponse(error);
  if (known) return c.json(known.body, known.status);
  console.error(error);
  return c.json({ error: "internal" }, 500);
});

export default app;
