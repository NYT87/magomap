import { env } from "cloudflare:workers";
import { dbFromD1 } from "@magomap/db/d1";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { call, cookieFrom, devLogin, setCookieHeader } from "./helpers";
import { network } from "./msw";

function mockKakao(kakaoId: number, nickname = "지은") {
  network.use(
    http.post("https://kauth.kakao.com/oauth/token", async ({ request }) => {
      const form = new URLSearchParams(await request.text());
      if (form.get("code") !== "good-code" || form.get("client_secret") !== "test-client-secret") {
        return HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
      }
      return HttpResponse.json({ access_token: "kakao-access", token_type: "bearer" });
    }),
    http.get("https://kapi.kakao.com/v2/user/me", ({ request }) => {
      if (request.headers.get("authorization") !== "Bearer kakao-access") {
        return HttpResponse.json({}, { status: 401 });
      }
      return HttpResponse.json({ id: kakaoId, properties: { nickname } });
    }),
  );
}

async function startState(): Promise<string> {
  const res = await call("/api/auth/kakao/start");
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location") ?? "");
  expect(location.origin + location.pathname).toBe("https://kauth.kakao.com/oauth/authorize");
  expect(location.searchParams.get("client_id")).toBe("test-rest-key");
  const state = cookieFrom(res, "mm_oauth_state");
  expect(state).toBeTruthy();
  expect(location.searchParams.get("state")).toBe(state);
  return state as string;
}

const callback = (state: string, cookieState = state) =>
  call(`/api/auth/kakao/callback?code=good-code&state=${state}`, {
    headers: { cookie: `mm_oauth_state=${cookieState}` },
  });

describe("Kakao sign-in", () => {
  it("rejects a callback whose state doesn't match the cookie", async () => {
    const state = await startState();
    const res = await callback(state, "something-else");
    expect(res.status).toBe(400);
  });

  it("sends someone not on the allowlist to /not-invited and creates no user", async () => {
    mockKakao(999);
    const res = await callback(await startState());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/not-invited");
    expect(cookieFrom(res, "mm_session")).toBeUndefined();
    const users = await dbFromD1(env.DB).kysely.selectFrom("identities").selectAll().execute();
    expect(users.filter((u) => u.provider_user_id === "999")).toHaveLength(0);
  });

  it("signs in an allowed user with a secure session cookie", async () => {
    mockKakao(111);
    const res = await callback(await startState());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const header = setCookieHeader(res, "mm_session") ?? "";
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\//);

    const me = await call("/api/me", {
      headers: { cookie: `mm_session=${cookieFrom(res, "mm_session")}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      displayName: "지은",
      identities: [{ provider: "kakao" }],
    });
  });

  it("lets anyone in when the allowlist is empty", async () => {
    mockKakao(555);
    const state = await startState();
    const res = await call(
      `/api/auth/kakao/callback?code=good-code&state=${state}`,
      { headers: { cookie: `mm_oauth_state=${state}` } },
      { ALLOWED_KAKAO_USER_IDS: "" },
    );
    expect(res.headers.get("location")).toBe("/");
  });

  it("answers 502 when Kakao fails, without leaking the secret", async () => {
    network.use(
      http.post("https://kauth.kakao.com/oauth/token", () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    const res = await callback(await startState());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("test-client-secret");
  });
});

describe("session and account", () => {
  it("requires a session for /api/me", async () => {
    expect((await call("/api/me")).status).toBe(401);
  });

  it("revokes the session on logout", async () => {
    const cookie = await devLogin();
    expect((await call("/api/me", { headers: { cookie } })).status).toBe(200);
    await call("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect((await call("/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("revokes every session on logout-all", async () => {
    const a = await devLogin();
    const b = await devLogin();
    await call("/api/auth/logout-all", { method: "POST", headers: { cookie: a } });
    expect((await call("/api/me", { headers: { cookie: b } })).status).toBe(401);
  });

  it("deletes the account", async () => {
    const cookie = await devLogin("222");
    expect((await call("/api/account", { method: "DELETE", headers: { cookie } })).status).toBe(
      204,
    );
    expect((await call("/api/me", { headers: { cookie } })).status).toBe(401);
    const ids = await dbFromD1(env.DB).kysely.selectFrom("identities").selectAll().execute();
    expect(ids.filter((i) => i.provider_user_id === "222")).toHaveLength(0);
  });
});

describe("dev login, health and config", () => {
  it("hides dev login unless ALLOW_DEV_LOGIN is true", async () => {
    const res = await call(
      "/api/auth/dev",
      {
        method: "POST",
        body: JSON.stringify({ kakaoUserId: "111" }),
        headers: { "content-type": "application/json" },
      },
      { ALLOW_DEV_LOGIN: "false" },
    );
    expect(res.status).toBe(404);
  });

  it("reports the database on /api/health", async () => {
    const res = await call("/api/health");
    expect(await res.json()).toEqual({ ok: true, db: "d1" });
  });

  it("serves the public config", async () => {
    expect(await (await call("/api/config")).json()).toEqual({
      kakaoJavascriptKey: "test-js-key",
      devLoginEnabled: true,
    });
    expect(
      await (
        await call("/api/config", {}, { ALLOW_DEV_LOGIN: "false", KAKAO_JAVASCRIPT_KEY: "" })
      ).json(),
    ).toEqual({
      kakaoJavascriptKey: null,
      devLoginEnabled: false,
    });
  });
});
