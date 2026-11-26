// The import routes check who is signed in once per request: the Kakao Map routes have their own
// check, and the run routes' check must not also run for them (each check reads the session).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, devLogin } from "./helpers";

/** The D1 binding, counting the statements that read the sessions table. */
function countingSessions(d1: D1Database) {
  let reads = 0;
  const db = new Proxy(d1, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          if (/from\s+"?sessions"?/i.test(query)) reads += 1;
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, reads: () => reads };
}

describe("sign-in checks on the import routes", () => {
  it("a Kakao Map request reads the session once", async () => {
    const cookie = await devLogin("import-auth-once");
    const counting = countingSessions(env.DB);
    const res = await call(
      "/api/import/kakao-map/account",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      },
      { DB: counting.db, ALLOW_DEV_UPLOAD: "true" },
    );
    // Refused for its body, after the sign-in check.
    expect(res.status).toBe(400);
    expect(counting.reads()).toBe(1);
  });

  it("the run routes still need a signed-in user", async () => {
    const res = await call("/api/import/runs/latest");
    expect(res.status).toBe(401);
  });
});
