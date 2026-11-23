import { exportUserData } from "@magomap/db/stores/export";
import {
  createSession,
  deleteAccount,
  deleteAllSessions,
  deleteSession,
  findOrCreateUserByIdentity,
  resolveSession,
  setDisplayName,
} from "@magomap/db/stores/users";
import { isStorableText, LIMITS, type Me } from "@magomap/domain";
import { usableNickname } from "@magomap/domain/providers/kakao";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { authorizeUrl, isAllowed, KakaoError, kakaoUserFromCode } from "./kakao";
import {
  ACCOUNT_HEADER,
  clearSessionCookie,
  requireSession,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
} from "./session";

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
  // "A different Kakao account": make Kakao ask, instead of reusing the browser's Kakao login.
  const forceLogin = c.req.query("account") === "other";
  return c.redirect(authorizeUrl(c.env, state, { forceLogin }), 302);
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
  // magomap never takes Kakao's nickname: the name starts empty (filled by an import or typed).
  await signIn(c, kakao.kakaoUserId, null);
  return c.redirect("/", 302);
});

authRoutes.post("/auth/dev", async (c) => {
  if (c.env.ALLOW_DEV_LOGIN !== "true") return c.json({ error: "not_found" }, 404);
  const body = z
    .object({ kakaoUserId: z.string().min(1).max(100), nickname: z.string().max(100).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  await signIn(c, body.data.kakaoUserId, usableNickname(body.data.nickname) ?? null);
  return c.json({ ok: true });
});

/** The signed-in account, as /api/me answers it. */
async function meOf(c: Context<AppEnv>): Promise<Me> {
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
  return {
    userId: c.var.userId,
    displayName: user?.display_name ?? null,
    identities: identities.map((i) => ({ provider: i.provider as "kakao" | "google" })),
  };
}

authRoutes.get("/me", requireSession, async (c) => c.json(await meOf(c)));

/** Edits the account's name; empty (or only spaces) clears it, so the next import may fill it. */
authRoutes.patch("/me", requireUser, async (c) => {
  const body = z
    .object({ displayName: z.string() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const name = body.data.displayName.trim();
  if (Array.from(name).length > LIMITS.nickname || !isStorableText(name)) {
    return c.json({ error: "invalid" }, 400);
  }
  await setDisplayName(c.var.db, c.var.userId, name || null);
  return c.json(await meOf(c));
});

authRoutes.post("/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    // A page showing another account (this browser signed in again elsewhere) can't sign this one out.
    const session = await resolveSession(c.var.db, token, Date.now());
    if (session && c.req.header(ACCOUNT_HEADER) !== session.userId) {
      return c.json({ error: "account_mismatch" }, 409);
    }
    await deleteSession(c.var.db, token);
  }
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.post("/auth/logout-all", requireUser, async (c) => {
  await deleteAllSessions(c.var.db, c.var.userId);
  clearSessionCookie(c);
  return c.body(null, 204);
});

/** Everything of the account's own, as a JSON file to keep (docs/deploy.md, "Exporting one user's data"). */
authRoutes.get("/me/export", requireUser, async (c) => {
  const now = Date.now();
  const data = await exportUserData(c.var.db, c.var.userId, now);
  const day = new Date(now).toISOString().slice(0, 10);
  c.header("Content-Disposition", `attachment; filename="magomap-export-${day}.json"`);
  c.header("Cache-Control", "no-store");
  return c.body(JSON.stringify(data), 200, { "Content-Type": "application/json; charset=utf-8" });
});

authRoutes.delete("/account", requireUser, async (c) => {
  await deleteAccount(c.var.db, c.var.userId);
  clearSessionCookie(c);
  return c.body(null, 204);
});
