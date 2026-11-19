import { env } from "cloudflare:workers";
import app from "../src/index";

export type TestEnv = typeof env;

export function call(path: string, init: RequestInit = {}, overrides: Partial<TestEnv> = {}) {
  return app.request(`https://magomap.test${path}`, init, { ...env, ...overrides });
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
  return `mm_session=${cookieFrom(res, "mm_session")}`;
}
