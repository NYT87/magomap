import type { Env } from "../env";

export class KakaoError extends Error {}

/** https://developers.kakao.com/docs/latest/en/kakaologin/rest-api */
export function authorizeUrl(env: Env, state: string): string {
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
  url.searchParams.set("redirect_uri", env.KAKAO_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Exchanges the code and reads the Kakao user. Kakao's tokens are not kept. */
export async function kakaoUserFromCode(
  env: Env,
  code: string,
): Promise<{ kakaoUserId: string; nickname: string | null }> {
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.KAKAO_REST_API_KEY,
      client_secret: env.KAKAO_CLIENT_SECRET,
      redirect_uri: env.KAKAO_REDIRECT_URI,
      code,
    }),
  });
  if (!tokenRes.ok) throw new KakaoError(`token exchange failed: ${tokenRes.status}`);
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) throw new KakaoError("token exchange returned no access token");

  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) throw new KakaoError(`user info failed: ${meRes.status}`);
  const me = (await meRes.json()) as {
    id?: number | string;
    properties?: { nickname?: string };
    kakao_account?: { profile?: { nickname?: string } };
  };
  if (me.id === undefined) throw new KakaoError("user info had no id");
  return {
    kakaoUserId: String(me.id),
    nickname: me.kakao_account?.profile?.nickname ?? me.properties?.nickname ?? null,
  };
}

/** An empty allowlist means sign-up is open. */
export function isAllowed(env: Env, kakaoUserId: string): boolean {
  const ids = env.ALLOWED_KAKAO_USER_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length === 0 || ids.includes(kakaoUserId);
}
