// Signs in with dev login on a local `wrangler dev` and syncs a small Kakao Map read into it,
// through the same routes the magomap extension's read goes through (start, pages, finish,
// complete). Needs ALLOW_DEV_LOGIN=true and ALLOW_DEV_UPLOAD=true in .dev.vars.
//   pnpm --filter @magomap/api dev:seed     (API_URL defaults to http://localhost:8787, KAKAO_USER to 111)

const api = process.env.API_URL ?? "http://localhost:8787";
const kakaoUserId = process.env.KAKAO_USER ?? "111";
/** The Kakao Map account the read comes from (one per magomap account). */
const account = `dev-kakao-map-${kakaoUserId}`;

const login = await fetch(`${api}/api/auth/dev`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ kakaoUserId, nickname: "dev" }),
});
if (!login.ok) throw new Error(`dev login failed: ${login.status} (is ALLOW_DEV_LOGIN=true?)`);
const cookie =
  (login.headers.getSetCookie().find((c) => c.startsWith("mm_session=")) ?? "").split(";")[0] ?? "";
const me = (await (await fetch(`${api}/api/me`, { headers: { cookie } })).json()) as {
  userId: string;
};
const call = async (path: string, body: unknown) => {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    // Account-scoped routes need to be told which account the request acts for.
    headers: { cookie, "content-type": "application/json", "x-magomap-user": me.userId },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

// A raw Kakao Map read, as the extension hands it over: folders, then each folder's favourites.
const folder = (folderid: number, title: string) => ({
  folderid,
  title,
  status: "O",
  subscribe: "N",
  kakao_map_user_id: account,
  nickname: "dev",
});
const favorite = (seq: number, key: string, name: string, lat: number, lon: number) => ({
  seq,
  key,
  type: "PLACE",
  display1: name,
  display2: "제주",
  lat,
  lon,
  color: "01",
});
const folders = [folder(101, "제주 카페"), folder(102, "서울 맛집")];
const favorites: Record<number, unknown[]> = {
  101: [
    favorite(9001, "27324155", "바다정원 카페", 33.4627, 126.3095),
    favorite(9002, "8125123", "돌담 브런치", 33.4101, 126.2659),
  ],
  102: [favorite(9101, "11223344", "명동 칼국수", 37.5636, 126.9852)],
};

const { runId, lists } = (await call("/api/import/kakao-map/runs", {
  folders,
  counts: folders.map((f) => ({ folderid: f.folderid, itemCount: favorites[f.folderid]?.length })),
  confirmAccount: account,
})) as { runId: string; lists: { externalId: string }[] };
for (const list of lists) {
  const id = encodeURIComponent(list.externalId);
  // Each list fits in one page (≤ 500 favourites).
  await call(`/api/import/kakao-map/runs/${runId}/lists/${id}/pages/0`, {
    favorites: favorites[Number(list.externalId)] ?? [],
  });
  await call(`/api/import/runs/${runId}/lists/${id}/finish`, {});
}
const summary = await call(`/api/import/runs/${runId}/complete`, {});
console.log("synced", summary);

export {};
