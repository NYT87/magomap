// Signs in with dev login on a local `wrangler dev` and runs a full Kakao import from the fake kakao-list.
//   pnpm --filter @magomap/api dev:seed     (API_URL defaults to http://localhost:8787, KAKAO_USER to 111)
import { kakaoContractToImport } from "@magomap/domain/providers/kakao";

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

const contract = kakaoContractToImport(await call("/api/import/kakao/source"));
const { runId } = (await call("/api/import/runs", "POST", {
  provider: contract.provider,
  complete: contract.complete,
  subscriptionKnown: contract.subscriptionKnown,
  importedAt: contract.importedAt,
})) as { runId: string };
for (const list of contract.lists) {
  const { items, ...meta } = list;
  for (let i = 0; i * 500 < Math.max(items.length, 1); i++) {
    await call(`/api/import/runs/${runId}/lists/${meta.externalId}/chunks/${i}`, "PUT", {
      meta,
      items: items.slice(i * 500, (i + 1) * 500),
    });
  }
  await call(`/api/import/runs/${runId}/lists/${meta.externalId}/finish`, "POST", {});
}
const summary = await call(`/api/import/runs/${runId}/complete`, "POST", {
  externalIds: contract.lists.map((l) => l.externalId),
});
console.log("imported", summary);
