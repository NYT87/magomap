// A stand-in for kakao-list's magomap endpoint, for local dev and end-to-end tests.
//   tsx apps/api/scripts/fake-kakao-list.ts            (port 8788, or FAKE_KAKAO_LIST_PORT)
//   POST /__variant {"name":"withoutFavourite","args":["9002"]}  switches the served data
// Serves kakao-list's paged magomap endpoints, checking the bearer secret:
//   GET /api/integrations/magomap/lists?kakaoUserId=…
//   GET /api/integrations/magomap/lists/:folderId/items?kakaoUserId=…&offset=…&limit=…
import { createServer } from "node:http";
import { contractFor, type Variant } from "../test/fixtures/contractVariants";
import { itemsBody, listsBody } from "../test/fixtures/pages";

const port = Number(process.env.FAKE_KAKAO_LIST_PORT ?? 8788);
const secret = process.env.MAGOMAP_IMPORT_SECRET ?? "m".repeat(48);
const knownUsers = new Set((process.env.FAKE_KAKAO_USERS ?? "111,222,dev").split(","));
let variant: Variant = { name: "base" };
// Each variant is a new kakao-list snapshot, as a real re-import would be (the base keeps the fixture's time).
let variantAt: string | null = null;

const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/__health") return send(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/__variant") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    variant = JSON.parse(raw) as Variant;
    variantAt = variant.name === "base" ? null : new Date(Date.now() - 1_000).toISOString();
    return send(res, 200, { ok: true, variant });
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/integrations/magomap/lists")) {
    if (req.headers.authorization !== `Bearer ${secret}`)
      return send(res, 401, { error: "unauthorized" });
    const user = url.searchParams.get("kakaoUserId") ?? "";
    if (!knownUsers.has(user)) return send(res, 404, { error: "no_snapshot" });
    const contract = contractFor(variant, user);
    if (variantAt) contract.importedAt = variantAt;
    if (url.pathname === "/api/integrations/magomap/lists")
      return send(res, 200, listsBody(contract));
    const match = url.pathname.match(/^\/api\/integrations\/magomap\/lists\/(\d+)\/items$/);
    const body = match
      ? itemsBody(
          contract,
          Number(match[1]),
          Number(url.searchParams.get("offset") ?? 0),
          Number(url.searchParams.get("limit") ?? 500),
        )
      : null;
    return body ? send(res, 200, body) : send(res, 404, { error: "no_snapshot" });
  }
  send(res, 404, { error: "not_found" });
}).listen(port, "127.0.0.1", () => console.log(`fake kakao-list on http://localhost:${port}`));
