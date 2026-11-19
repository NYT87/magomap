import { resolveSession, SESSION_TTL_MS } from "@magomap/db/stores/users";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";

export const SESSION_COOKIE = "mm_session";

export function setSessionCookie(c: Context<AppEnv>, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
}

/** Requires a valid session; sets `userId`, and slides the cookie when the session was extended. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await resolveSession(c.var.db, token, Date.now()) : null;
  if (!session || !token) return c.json({ error: "unauthorized" }, 401);
  if (session.refreshedExpiresAt) setSessionCookie(c, token, session.refreshedExpiresAt);
  c.set("userId", session.userId);
  await next();
};
