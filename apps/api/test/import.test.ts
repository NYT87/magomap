import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { baseContract } from "./fixtures/contract";
import { call, devLogin } from "./helpers";
import { network } from "./msw";

const KAKAO_LIST = "http://localhost:8788/api/integrations/magomap/snapshot";
const jsonInit = (method: string, body: unknown, cookie: string) => ({
  method,
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(body),
});

describe("import source", () => {
  it("passes kakao-list's body through and sends the secret", async () => {
    const cookie = await devLogin("111");
    const body = JSON.stringify(baseContract("111"));
    let auth = "";
    let asked = "";
    network.use(
      http.get(KAKAO_LIST, ({ request }) => {
        auth = request.headers.get("authorization") ?? "";
        asked = new URL(request.url).searchParams.get("kakaoUserId") ?? "";
        return new HttpResponse(body, { headers: { "content-type": "application/json" } });
      }),
    );
    const res = await call("/api/import/kakao/source", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(auth).toBe(`Bearer ${"m".repeat(48)}`);
    expect(asked).toBe("111");
  });

  it("maps kakao-list's no_snapshot to 404 no_snapshot", async () => {
    const cookie = await devLogin("111");
    network.use(
      http.get(KAKAO_LIST, () => HttpResponse.json({ error: "no_snapshot" }, { status: 404 })),
    );
    const res = await call("/api/import/kakao/source", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_snapshot" });
  });

  it("maps any other failure to 502", async () => {
    const cookie = await devLogin("111");
    network.use(http.get(KAKAO_LIST, () => HttpResponse.text("nope", { status: 404 })));
    expect((await call("/api/import/kakao/source", { headers: { cookie } })).status).toBe(502);
    network.use(http.get(KAKAO_LIST, () => HttpResponse.text("boom", { status: 500 })));
    const res = await call("/api/import/kakao/source", { headers: { cookie } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "kakao_list_unavailable" });
  });
});

describe("import runs", () => {
  it("imports a list through the run endpoints", async () => {
    const cookie = await devLogin("111");
    const contract = baseContract();
    const start = await call(
      "/api/import/runs",
      jsonInit("POST", { complete: true, importedAt: contract.importedAt }, cookie),
    );
    const { runId } = (await start.json()) as { runId: string };
    const { items, ...meta } = contract.lists[0] as (typeof contract.lists)[number];
    const chunk = await call(
      `/api/import/runs/${runId}/lists/101/chunks/0`,
      jsonInit("PUT", { meta, items }, cookie),
    );
    expect(chunk.status).toBe(200);
    expect(await chunk.json()).toMatchObject({ placesAdded: 2, notesImported: 1 });
    expect(
      (await call(`/api/import/runs/${runId}/lists/101/finish`, jsonInit("POST", {}, cookie)))
        .status,
    ).toBe(200);
    const done = await call(
      `/api/import/runs/${runId}/complete`,
      jsonInit("POST", { kakaoFolderIds: [101] }, cookie),
    );
    expect(await done.json()).toMatchObject({ listsAdded: 1, placesAdded: 2 });
    const latest = await call("/api/import/runs/latest", { headers: { cookie } });
    expect(await latest.json()).toMatchObject({ runId, status: "completed" });
  });

  it("does not let another user write to a run", async () => {
    const owner = await devLogin("111");
    const other = await devLogin("222");
    const { runId } = (await (
      await call("/api/import/runs", jsonInit("POST", { complete: true, importedAt: "x" }, owner))
    ).json()) as { runId: string };
    const meta = { kakaoFolderId: 101, name: "x", subscribed: false };
    const res = await call(
      `/api/import/runs/${runId}/lists/101/chunks/0`,
      jsonInit("PUT", { meta, items: [] }, other),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a chunk over 500 items and a folder mismatch", async () => {
    const cookie = await devLogin("111");
    const { runId } = (await (
      await call("/api/import/runs", jsonInit("POST", { complete: true, importedAt: "x" }, cookie))
    ).json()) as { runId: string };
    const meta = { kakaoFolderId: 101, name: "x", subscribed: false };
    const items = Array.from({ length: 501 }, (_, i) => ({
      favoriteSeq: String(i),
      placeKey: `P${i}`,
      title: "t",
      position: i,
    }));
    expect(
      (
        await call(
          `/api/import/runs/${runId}/lists/101/chunks/0`,
          jsonInit("PUT", { meta, items }, cookie),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          `/api/import/runs/${runId}/lists/999/chunks/0`,
          jsonInit("PUT", { meta, items: [] }, cookie),
        )
      ).status,
    ).toBe(400);
  });

  it("answers 409 for a superseded run", async () => {
    const cookie = await devLogin("111");
    const first = (await (
      await call("/api/import/runs", jsonInit("POST", { complete: true, importedAt: "x" }, cookie))
    ).json()) as { runId: string };
    await call("/api/import/runs", jsonInit("POST", { complete: true, importedAt: "x" }, cookie));
    const meta = { kakaoFolderId: 101, name: "x", subscribed: false };
    const res = await call(
      `/api/import/runs/${first.runId}/lists/101/chunks/0`,
      jsonInit("PUT", { meta, items: [] }, cookie),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run_closed" });
  });
});
