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

/** The header naming the account a client's request acts for (its local database's owner). */
export const ACCOUNT_HEADER = "x-magomap-user";

async function session(c: Context<AppEnv>, next: () => Promise<void>, checkAccount: boolean) {
  const token = getCookie(c, SESSION_COOKIE);
  const found = token ? await resolveSession(c.var.db, token, Date.now()) : null;
  if (!found || !token) return c.json({ error: "unauthorized" }, 401);
  // Another tab signed in as someone else: refuse, so one account's data never lands in the other.
  const claimed = c.req.header(ACCOUNT_HEADER);
  // A request that doesn't say (an app from before this check) is refused too: reloading fixes it.
  if (checkAccount && claimed !== found.userId) {
    return c.json({ error: "account_mismatch" }, 409);
  }
  if (found.refreshedExpiresAt) setSessionCookie(c, token, found.refreshedExpiresAt);
  c.set("userId", found.userId);
  await next();
}

/**
 * Requires a valid session for the account the request claims to act for; sets `userId`, and
 * slides the cookie when the session was extended.
 */
export const requireUser: MiddlewareHandler<AppEnv> = (c, next) => session(c, next, true);

/** Requires a valid session, whoever it belongs to (who-am-I). */
export const requireSession: MiddlewareHandler<AppEnv> = (c, next) => session(c, next, false);
