import {
  createSession,
  deleteAccount,
  deleteAllSessions,
  deleteSession,
  findOrCreateUserByIdentity,
} from "@magomap/db/stores/users";
import type { Me } from "@magomap/domain";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { authorizeUrl, isAllowed, KakaoError, kakaoUserFromCode } from "./kakao";
import { clearSessionCookie, requireUser, SESSION_COOKIE, setSessionCookie } from "./session";

const STATE_COOKIE = "mm_oauth_state";

function randomState(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signIn(c: Context<AppEnv>, kakaoUserId: string, nickname: string | null) {
  const now = Date.now();
  const { userId } = await findOrCreateUserByIdentity(
    c.var.db,
    "kakao",
    kakaoUserId,
    nickname,
    now,
  );
  const { token, expiresAt } = await createSession(c.var.db, userId, now);
  setSessionCookie(c, token, expiresAt);
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/auth/kakao/start", (c) => {
  const state = randomState();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return c.redirect(authorizeUrl(c.env, state), 302);
});

authRoutes.get("/auth/kakao/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
  if (!state || !code || !expected || state !== expected) {
    return c.json({ error: "invalid_state" }, 400);
  }
  let kakao: Awaited<ReturnType<typeof kakaoUserFromCode>>;
  try {
    kakao = await kakaoUserFromCode(c.env, code);
  } catch (error) {
    if (error instanceof KakaoError) return c.json({ error: "kakao_unavailable" }, 502);
    throw error;
  }
  if (!isAllowed(c.env, kakao.kakaoUserId)) return c.redirect("/not-invited", 302);
  await signIn(c, kakao.kakaoUserId, kakao.nickname);
  return c.redirect("/", 302);
});

authRoutes.post("/auth/dev", async (c) => {
  if (c.env.ALLOW_DEV_LOGIN !== "true") return c.json({ error: "not_found" }, 404);
  const body = z
    .object({ kakaoUserId: z.string().min(1).max(100), nickname: z.string().max(100).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  await signIn(c, body.data.kakaoUserId, body.data.nickname ?? null);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, async (c) => {
  const user = await c.var.db.kysely
    .selectFrom("users")
    .select("display_name")
    .where("id", "=", c.var.userId)
    .executeTakeFirst();
  const identities = await c.var.db.kysely
    .selectFrom("identities")
    .select("provider")
    .where("user_id", "=", c.var.userId)
    .execute();
  const me: Me = {
    userId: c.var.userId,
    displayName: user?.display_name ?? null,
    identities: identities.map((i) => ({ provider: i.provider as "kakao" | "google" })),
  };
  return c.json(me);
});

authRoutes.post("/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.var.db, token);
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.post("/auth/logout-all", requireUser, async (c) => {
  await deleteAllSessions(c.var.db, c.var.userId);
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.delete("/account", requireUser, async (c) => {
  await deleteAccount(c.var.db, c.var.userId);
  clearSessionCookie(c);
  return c.body(null, 204);
});
