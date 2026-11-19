import { env } from "cloudflare:workers";
import app from "../src/index";

export type TestEnv = typeof env;

/** Which account each signed-in test cookie belongs to. */
const accounts = new Map<string, string>();

/**
 * Calls the app. Like the web app, a request with a known session cookie says which account it
 * acts for, unless the test sets x-magomap-user itself.
 */
export function call(path: string, init: RequestInit = {}, overrides: Partial<TestEnv> = {}) {
  const headers = new Headers(init.headers);
  const account = accounts.get(headers.get("cookie") ?? "");
  if (account && !headers.has("x-magomap-user")) headers.set("x-magomap-user", account);
  return app.request(`https://magomap.test${path}`, { ...init, headers }, { ...env, ...overrides });
}

/** The value of one cookie from a response's Set-Cookie headers. */
export function cookieFrom(res: Response, name: string): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const [key, ...value] = (pair ?? "").split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export function setCookieHeader(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((h) => h.startsWith(`${name}=`));
}

/** Signs in through the dev route and returns the Cookie header to send. */
export async function devLogin(kakaoUserId = "111"): Promise<string> {
  const res = await call("/api/auth/dev", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kakaoUserId }),
  });
  if (res.status !== 200) throw new Error(`dev login failed: ${res.status}`);
  const cookie = `mm_session=${cookieFrom(res, "mm_session")}`;
  const me = (await (await call("/api/me", { headers: { cookie } })).json()) as { userId: string };
  accounts.set(cookie, me.userId);
  return cookie;
}
