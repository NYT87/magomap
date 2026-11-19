// Signs in with dev login on a local `wrangler dev` and runs a full Kakao import from the fake kakao-list.
//   pnpm --filter @magomap/api dev:seed     (API_URL defaults to http://localhost:8787, KAKAO_USER to 111)

const api = process.env.API_URL ?? "http://localhost:8787";
const kakaoUserId = process.env.KAKAO_USER ?? "111";

const login = await fetch(`${api}/api/auth/dev`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ kakaoUserId, nickname: "dev" }),
});
if (!login.ok) throw new Error(`dev login failed: ${login.status} (is ALLOW_DEV_LOGIN=true?)`);
const cookie =
  (login.headers.getSetCookie().find((c) => c.startsWith("mm_session=")) ?? "").split(";")[0] ?? "";
const call = async (path: string, method = "GET", body?: unknown) => {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

// The server fetches everything from kakao-list itself; this script only drives the pages.
const { runId, lists } = (await call("/api/import/runs", "POST", { provider: "kakao" })) as {
  runId: string;
  lists: { externalId: string; itemCount: number }[];
};
for (const list of lists) {
  for (let page = 0; ; page++) {
    const result = (await call(
      `/api/import/runs/${runId}/lists/${list.externalId}/pages/${page}`,
      "POST",
      {},
    )) as { done: boolean };
    if (result.done) break;
  }
  await call(`/api/import/runs/${runId}/lists/${list.externalId}/finish`, "POST", {});
}
const summary = await call(`/api/import/runs/${runId}/complete`, "POST", {});
console.log("imported", summary);

export {};
