// The upload run: magomap's page sends a raw Kakao Map read (folders, then each folder's
// favourites), and the Worker maps it, checks who may upload and which Kakao Map account it is,
// and imports it through the same import runs as kakao-list.
import { env } from "cloudflare:workers";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { baseContract } from "./fixtures/contract";
import { itemsBody, listsBody } from "./fixtures/pages";
import { call, devLogin, type TestEnv } from "./helpers";
import { network } from "./msw";

const KL = "http://localhost:8788/api/integrations/magomap";
const RUNS = "/api/import/kakao-map/runs";
/** Uploads allowed for any signed-in user (tests use many accounts; the allowlist has two). */
const DEV: Partial<TestEnv> = { ALLOW_DEV_UPLOAD: "true" };

type Raw = Record<string, unknown>;

/** A raw `/folder/list` record of the reader's own folder. */
const ownFolder = (folderid: number, account: string, extra: Raw = {}): Raw => ({
  folderid,
  title: `리스트 ${folderid}`,
  status: "O",
  subscribe: "N",
  kakao_map_user_id: account,
  nickname: "수지",
  favorite_cnt: 1,
  ...extra,
});

/** A raw `/favorite/mine/list` record. */
const favorite = (seq: number, key: string, extra: Raw = {}): Raw => ({
  seq,
  key,
  type: "PLACE",
  display1: `장소 ${seq}`,
  display2: "제주 애월읍",
  lat: 33.4627,
  lon: 126.3095,
  color: "01",
  ...extra,
});

interface Read {
  folders: Raw[];
  favorites: Record<number, Raw[]>;
}

const startBody = (read: Read, extra: Raw = {}) => ({
  folders: read.folders,
  counts: read.folders.map((f) => ({
    folderid: f.folderid as number,
    itemCount: read.favorites[f.folderid as number]?.length ?? 0,
  })),
  ...extra,
});

const post = (cookie: string, body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(body),
});

interface Started {
  runId: string;
  lists: { externalId: string; name: string; itemCount: number }[];
}

async function startRun(cookie: string, body: unknown, overrides: Partial<TestEnv> = DEV) {
  const res = await call(RUNS, post(cookie, body), overrides);
  return { res, body: (await res.json()) as Started & { error?: string; account?: unknown } };
}

const pageUrl = (runId: string, externalId: string, index: number) =>
  `${RUNS}/${runId}/lists/${encodeURIComponent(externalId)}/pages/${index}`;

/** Start (confirming the account), every page, finish, complete. */
async function upload(cookie: string, read: Read, account: string, overrides = DEV) {
  const started = await startRun(cookie, startBody(read, { confirmAccount: account }), overrides);
  expect(started.res.status).toBe(200);
  const { runId, lists } = started.body;
  for (const l of lists) {
    const folderid = l.externalId.startsWith("0~") ? 0 : Number(l.externalId);
    const all = read.favorites[folderid] ?? [];
    for (let i = 0; i < Math.max(1, Math.ceil(all.length / 500)); i++) {
      const res = await call(
        pageUrl(runId, l.externalId, i),
        post(cookie, { favorites: all.slice(i * 500, (i + 1) * 500) }),
        overrides,
      );
      expect(res.status).toBe(200);
    }
    const finish = await call(
      `/api/import/runs/${runId}/lists/${encodeURIComponent(l.externalId)}/finish`,
      post(cookie, {}),
      overrides,
    );
    expect(finish.status).toBe(200);
  }
  const done = await call(`/api/import/runs/${runId}/complete`, post(cookie, {}), overrides);
  expect(done.status).toBe(200);
  return { runId, lists };
}

const userIdOf = async (cookie: string) =>
  ((await (await call("/api/me", { headers: { cookie } })).json()) as { userId: string }).userId;

const count = async (sql: string, ...params: unknown[]) =>
  Number(
    (
      await env.DB.prepare(sql)
        .bind(...params)
        .first<{ n: number }>()
    )?.n ?? 0,
  );
const runsOf = (userId: string) =>
  count("SELECT COUNT(*) AS n FROM import_runs WHERE user_id = ?", userId);
const bindingOf = async (userId: string) =>
  env.DB.prepare(
    "SELECT kakao_map_user_id AS id, nickname FROM kakao_map_accounts WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ id: string; nickname: string | null }>();

/** One own folder with two favourites, read from Kakao Map account `account`. */
const smallRead = (account: string, folderid: number, extra: Raw = {}): Read => ({
  folders: [ownFolder(folderid, account, extra)],
  favorites: {
    [folderid]: [
      favorite(folderid * 10 + 1, `${folderid}01`),
      favorite(folderid * 10 + 2, `${folderid}02`),
    ],
  },
});

describe("who may upload", () => {
  it("refuses users outside a non-empty allowlist", async () => {
    const cookie = await devLogin("km-outsider");
    const { res, body } = await startRun(cookie, startBody(smallRead("kmo1", 30001)), {});
    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "not_allowed" });
    // An allowlisted caller gets past the check (to the account question).
    const allowed = await devLogin("111");
    expect((await startRun(allowed, startBody(smallRead("kma1", 30002)), {})).res.status).toBe(409);
  });

  it('refuses everyone when the allowlist is empty and ALLOW_DEV_UPLOAD isn\'t "true"', async () => {
    const cookie = await devLogin("111");
    for (const overrides of [
      { ALLOWED_KAKAO_USER_IDS: "" },
      { ALLOWED_KAKAO_USER_IDS: " , ", ALLOW_DEV_UPLOAD: "false" },
    ]) {
      const { res, body } = await startRun(cookie, startBody(smallRead("kme1", 30003)), overrides);
      expect(res.status).toBe(403);
      expect(body).toEqual({ error: "not_allowed" });
    }
    // The dev flag opens uploads when the allowlist is empty (local dev only).
    const dev = await startRun(cookie, startBody(smallRead("kme1", 30003)), {
      ALLOWED_KAKAO_USER_IDS: "",
      ALLOW_DEV_UPLOAD: "true",
    });
    expect(dev.res.status).toBe(409);
  });

  it("refuses an upload page from someone not allowed", async () => {
    const cookie = await devLogin("km-page-outsider");
    const res = await call(pageUrl("nope", "30004", 0), post(cookie, { favorites: [] }), {});
    expect(res.status).toBe(403);
  });
});

describe("the Kakao Map account", () => {
  it("first sync asks to confirm the account", async () => {
    const cookie = await devLogin("km-first");
    const user = await userIdOf(cookie);
    const read = smallRead("u1-first-12345678", 31001);
    const asked = await startRun(cookie, startBody(read));
    expect(asked.res.status).toBe(409);
    expect(asked.body).toEqual({
      error: "kakao_account_unconfirmed",
      account: { nickname: "수지", idTail: "5678" },
    });
    expect(await runsOf(user)).toBe(0);
    expect(await bindingOf(user)).toBeNull();

    const confirmed = await startRun(
      cookie,
      startBody(read, { confirmAccount: "u1-first-12345678" }),
    );
    expect(confirmed.res.status).toBe(200);
    expect(confirmed.body.lists).toEqual([
      { externalId: "31001", name: "리스트 31001", itemCount: 2 },
    ]);
    expect(await bindingOf(user)).toEqual({ id: "u1-first-12345678", nickname: "수지" });
    // Once bound, the same account needs no confirmation.
    expect((await startRun(cookie, startBody(read))).res.status).toBe(200);
  });

  it("a confirmation for another account doesn't count", async () => {
    const cookie = await devLogin("km-wrong-confirm");
    const user = await userIdOf(cookie);
    const { res, body } = await startRun(
      cookie,
      startBody(smallRead("u1-wc-0001", 31101), { confirmAccount: "someone-else" }),
    );
    expect(res.status).toBe(409);
    expect(body.error).toBe("kakao_account_unconfirmed");
    expect(await bindingOf(user)).toBeNull();
  });

  it("a different Kakao Map account is refused until confirmed", async () => {
    const cookie = await devLogin("km-mismatch");
    const user = await userIdOf(cookie);
    await upload(cookie, smallRead("u1-mm-aaaa", 32001), "u1-mm-aaaa");
    const runs = await runsOf(user);
    const other = smallRead("u2-mm-bbbb", 32002, { nickname: "호세" });
    const refused = await startRun(cookie, startBody(other));
    expect(refused.res.status).toBe(409);
    expect(refused.body).toEqual({
      error: "kakao_account_mismatch",
      account: { nickname: "호세", idTail: "bbbb" },
      // The account she synced from before, so the prompt can name both.
      bound: { nickname: "수지", idTail: "aaaa" },
    });
    expect(await runsOf(user)).toBe(runs);
    expect((await bindingOf(user))?.id).toBe("u1-mm-aaaa");

    const switched = await startRun(cookie, startBody(other, { confirmAccount: "u2-mm-bbbb" }));
    expect(switched.res.status).toBe(200);
    expect(await bindingOf(user)).toEqual({ id: "u2-mm-bbbb", nickname: "호세" });
  });

  it("an account bound to another user is refused", async () => {
    const owner = await devLogin("km-taken-owner");
    const other = await devLogin("km-taken-other");
    const read = smallRead("u1-taken-9999", 33001);
    await upload(owner, read, "u1-taken-9999");
    const otherUser = await userIdOf(other);
    // Even confirmed, it stays hers.
    const res = await startRun(other, startBody(read, { confirmAccount: "u1-taken-9999" }));
    expect(res.res.status).toBe(409);
    expect(res.body).toEqual({ error: "kakao_account_taken" });
    expect(await runsOf(otherUser)).toBe(0);
    expect(await bindingOf(otherUser)).toBeNull();
  });

  it("the other person's Kakao Map, after she bound it, is refused for him", async () => {
    const she = await devLogin("km-she");
    const he = await devLogin("km-he");
    const hisId = await userIdOf(he);
    const hers = smallRead("u1-hers-7800", 34001, { nickname: "수지" });
    const shePrompt = await startRun(she, startBody(hers));
    expect(shePrompt.body).toEqual({
      error: "kakao_account_unconfirmed",
      account: { nickname: "수지", idTail: "7800" },
    });
    expect(
      (await startRun(she, startBody(hers, { confirmAccount: "u1-hers-7800" }))).res.status,
    ).toBe(200);

    // His browser is still signed in to her Kakao Map: refused, with nothing about her account.
    const taken = await startRun(he, startBody(hers));
    expect(taken.res.status).toBe(409);
    expect(taken.body).toEqual({ error: "kakao_account_taken" });
    expect(await runsOf(hisId)).toBe(0);

    // His own Kakao Map, on his first sync, asks him to confirm it by name.
    const his = smallRead("u2-his-4321", 34002, { nickname: "호세" });
    const asked = await startRun(he, startBody(his));
    expect(asked.res.status).toBe(409);
    expect(asked.body).toEqual({
      error: "kakao_account_unconfirmed",
      account: { nickname: "호세", idTail: "4321" },
    });
    expect(await runsOf(hisId)).toBe(0);
  });

  it("the 409 never carries the full Kakao Map user id", async () => {
    const cookie = await devLogin("km-tail");
    const res = await call(
      RUNS,
      post(cookie, startBody(smallRead("secret-full-id-5555", 34101))),
      DEV,
    );
    const text = await res.text();
    expect(text).toContain("5555");
    expect(text).not.toContain("secret-full-id");
  });

  it("unclear account gives 422, with nothing written", async () => {
    const cookie = await devLogin("km-unclear");
    const user = await userIdOf(cookie);
    const read: Read = {
      folders: [ownFolder(35001, "acct-a"), ownFolder(35002, "acct-b")],
      favorites: { 35001: [], 35002: [] },
    };
    const { res, body } = await startRun(cookie, startBody(read, { confirmAccount: "acct-a" }));
    expect(res.status).toBe(422);
    expect(body).toEqual({ error: "kakao_account_unclear" });
    expect(await runsOf(user)).toBe(0);
    expect(await bindingOf(user)).toBeNull();
  });
});

describe("checking the account before a copy to Kakao Map", () => {
  const ACCOUNT = "/api/import/kakao-map/account";

  it("accepts the bound account and writes nothing", async () => {
    const cookie = await devLogin("km-acct-ok");
    const user = await userIdOf(cookie);
    const read = smallRead("u1-acct-ok-1111", 33001);
    await upload(cookie, read, "u1-acct-ok-1111");
    const runs = await runsOf(user);
    const res = await call(ACCOUNT, post(cookie, { folders: read.folders }), DEV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await runsOf(user)).toBe(runs);
  });

  it("refuses another Kakao Map account, naming both by their last 4 characters", async () => {
    const cookie = await devLogin("km-acct-other");
    const user = await userIdOf(cookie);
    await upload(cookie, smallRead("u1-acct-aaaa", 33101), "u1-acct-aaaa");
    const other = smallRead("u2-acct-bbbb", 33102, { nickname: "호세" });
    const res = await call(ACCOUNT, post(cookie, { folders: other.folders }), DEV);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "kakao_account_mismatch",
      account: { nickname: "호세", idTail: "bbbb" },
      bound: { nickname: "수지", idTail: "aaaa" },
    });
    expect((await bindingOf(user))?.id).toBe("u1-acct-aaaa");
  });

  it("refuses when nothing is bound yet, and binds nothing", async () => {
    const cookie = await devLogin("km-acct-unbound");
    const user = await userIdOf(cookie);
    const read = smallRead("u1-acct-unb-9999", 33201);
    const res = await call(ACCOUNT, post(cookie, { folders: read.folders }), DEV);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("kakao_account_unconfirmed");
    expect(await bindingOf(user)).toBeNull();
  });

  it("refuses someone who isn't allowed", async () => {
    const cookie = await devLogin("km-acct-denied");
    const read = smallRead("u1-acct-den-0000", 33301);
    const res = await call(ACCOUNT, post(cookie, { folders: read.folders }), {
      ALLOWED_KAKAO_USER_IDS: "someone-else",
    });
    expect(res.status).toBe(403);
  });

  it("answers 422 for a signed-out read", async () => {
    const cookie = await devLogin("km-acct-out");
    const res = await call(ACCOUNT, post(cookie, { folders: [] }), DEV);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("kakao_signed_out");
  });
});

describe("changing a Kakao colour from magomap", () => {
  const COLORS = "/api/kakao-colors";
  const itemOf = (folderid: number, key: string) =>
    env.DB.prepare(
      "SELECT i.id AS item, i.list_id AS list, i.provider_color AS color, i.seq AS seq FROM list_items i WHERE i.list_id IN (SELECT id FROM lists WHERE external_id = ?) AND i.external_id IS NOT NULL ORDER BY i.position LIMIT 1 OFFSET ?",
    )
      .bind(String(folderid), key === "first" ? 0 : 1)
      .first<{ item: string; list: string; color: string | null; seq: number }>();

  async function owned(name: string, folderid: number, account: string) {
    const cookie = await devLogin(name);
    await upload(cookie, smallRead(account, folderid), account);
    const row = await itemOf(folderid, "first");
    if (!row) throw new Error("no item");
    return { cookie, ...row };
  }

  it("records the owner's colour, once the extension has changed it in Kakao Map", async () => {
    const { cookie, item, list, seq } = await owned("km-col-owner", 34001, "u1-col-aaaa");
    const res = await call(COLORS, post(cookie, { listId: list, itemId: item, color: "05" }), DEV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });
    const after = await itemOf(34001, "first");
    expect(after?.color).toBe("05");
    expect(Number(after?.seq)).toBeGreaterThan(Number(seq));
  });

  it("refuses someone who doesn't own the list, writing nothing", async () => {
    const { item, list } = await owned("km-col-own2", 34101, "u1-col-bbbb");
    const other = await devLogin("km-col-other");
    await upload(other, smallRead("u1-col-cccc", 34102), "u1-col-cccc");
    const res = await call(COLORS, post(other, { listId: list, itemId: item, color: "05" }), DEV);
    expect([403, 404]).toContain(res.status);
    expect((await itemOf(34101, "first"))?.color).toBe("01");
  });

  it("is 409 kakao_account_unconfirmed with no Kakao Map account bound", async () => {
    const cookie = await devLogin("km-col-unbound");
    const res = await call(COLORS, post(cookie, { listId: "l", itemId: "i", color: "05" }), DEV);
    expect([404, 409]).toContain(res.status);
  });

  it("refuses a colour that isn't a known code, and a malformed body", async () => {
    const { cookie, item, list } = await owned("km-col-bad", 34201, "u1-col-dddd");
    const bad = await call(COLORS, post(cookie, { listId: list, itemId: item, color: "99" }), DEV);
    expect(bad.status).toBe(400);
    const malformed = await call(COLORS, post(cookie, { listId: list }), DEV);
    expect(malformed.status).toBe(400);
    expect((await itemOf(34201, "first"))?.color).toBe("01");
  });

  it("refuses someone who isn't allowed to write", async () => {
    const { cookie, item, list } = await owned("km-col-denied", 34301, "u1-col-eeee");
    const res = await call(COLORS, post(cookie, { listId: list, itemId: item, color: "05" }), {
      ALLOWED_KAKAO_USER_IDS: "someone-else",
    });
    expect(res.status).toBe(403);
    expect((await itemOf(34301, "first"))?.color).toBe("01");
  });
});

describe("signed out", () => {
  it("a signed-out read (zero folders) gives 422 kakao_signed_out", async () => {
    const cookie = await devLogin("km-signed-out");
    const user = await userIdOf(cookie);
    const read = smallRead("u1-so-0000", 36001);
    await upload(cookie, read, "u1-so-0000");
    const runs = await runsOf(user);
    const before = await count(
      "SELECT COUNT(*) AS n FROM list_items WHERE list_id = 'l_kakao_36001' AND removed_at_provider IS NULL",
    );
    expect(before).toBe(2);

    for (const folders of [[], [{ folderid: 36001, status: "D" }], [{ title: "no id" }]]) {
      const { res, body } = await startRun(cookie, {
        folders,
        counts: [],
        confirmAccount: "u1-so-0000",
      });
      expect(res.status).toBe(422);
      expect(body).toEqual({ error: "kakao_signed_out" });
    }
    expect(await runsOf(user)).toBe(runs);
    expect((await bindingOf(user))?.id).toBe("u1-so-0000");
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM list_items WHERE list_id = 'l_kakao_36001' AND removed_at_provider IS NULL",
      ),
    ).toBe(before);
    const latest = (await (
      await call("/api/import/runs/latest", { headers: { cookie } })
    ).json()) as {
      status: string;
    };
    expect(latest.status).toBe("completed");
  });

  it("a read with no folder magomap can list is refused like a signed-out one", async () => {
    const cookie = await devLogin("km-unlistable");
    const user = await userIdOf(cookie);
    await upload(cookie, smallRead("u1-unl", 36101), "u1-unl");
    const runs = await runsOf(user);
    const live = () =>
      count("SELECT COUNT(*) AS n FROM user_lists WHERE user_id = ? AND removed_at IS NULL", user);
    const before = await live();
    expect(before).toBe(1);
    // A 16-digit folder id: a folder, but not one kakao-list's ids (≤ 15 digits) can name.
    const folderid = 1234567890123456;
    const { res, body } = await startRun(cookie, {
      folders: [ownFolder(folderid, "u2-unl")],
      counts: [{ folderid, itemCount: 0 }],
      confirmAccount: "u2-unl",
    });
    expect(res.status).toBe(422);
    expect(body).toEqual({ error: "kakao_signed_out" });
    expect(await runsOf(user)).toBe(runs);
    expect((await bindingOf(user))?.id).toBe("u1-unl");
    expect(await live()).toBe(before);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lists WHERE id = 'l_kakao_36101' AND removed_at_provider IS NOT NULL",
      ),
    ).toBe(0);
  });

  it("an account id over 200 characters is refused as unclear, with nothing written", async () => {
    const cookie = await devLogin("km-long-id");
    const user = await userIdOf(cookie);
    const long = "a".repeat(201);
    const { res, body } = await startRun(
      cookie,
      startBody(smallRead(long, 36201), { confirmAccount: long.slice(0, 200) }),
    );
    expect(res.status).toBe(422);
    expect(body).toEqual({ error: "kakao_account_unclear" });
    expect(await runsOf(user)).toBe(0);
    expect(await bindingOf(user)).toBeNull();
    // 200 characters is fine.
    const ok = "b".repeat(200);
    expect(
      (await startRun(cookie, startBody(smallRead(ok, 36202), { confirmAccount: ok }))).res.status,
    ).toBe(200);
  });

  it("a first-time signed-out read binds nothing", async () => {
    const cookie = await devLogin("km-signed-out-first");
    const user = await userIdOf(cookie);
    const { res } = await startRun(cookie, { folders: [], counts: [], confirmAccount: "x" });
    expect(res.status).toBe(422);
    expect(await bindingOf(user)).toBeNull();
    expect(await runsOf(user)).toBe(0);
  });
});

describe("importing", () => {
  it("folder 0 imports as the caller's own list", async () => {
    const zero = (account: string, seq: number): Read => ({
      folders: [ownFolder(0, account, { title: "기본 폴더" })],
      favorites: { 0: [favorite(seq, `k${seq}`)] },
    });
    const her = await devLogin("km-zero-a");
    const his = await devLogin("km-zero-b");
    const first = await upload(her, zero("zero-acct-a", 7101), "zero-acct-a");
    expect(first.lists.map((l) => l.externalId)).toEqual(["0~km-zero-a"]);
    await upload(his, zero("zero-acct-b", 7102), "zero-acct-b");
    const pulled = JSON.stringify(
      await (await call("/api/sync/pull", { headers: { cookie: her } })).json(),
    );
    expect(pulled).toContain("l_kakao_0%7Ekm-zero-a");
    expect(pulled).not.toContain("l_kakao_0%7Ekm-zero-b");
    expect(
      await count("SELECT COUNT(*) AS n FROM lists WHERE id LIKE 'l_kakao_0%7Ekm-zero-%'"),
    ).toBe(2);
  });

  it("a full upload imports lists and places", async () => {
    const cookie = await devLogin("km-full");
    const user = await userIdOf(cookie);
    const read: Read = {
      folders: [
        ownFolder(37001, "u1-full", { title: "제주 카페" }),
        ownFolder(37002, "u1-full", { title: "서울 맛집" }),
        {
          folderid: 37003,
          title: "민수의 부산 여행",
          status: "O",
          subscribe: "Y",
          kakao_map_user_id: "minsu",
          nickname: "민수",
        },
      ],
      favorites: {
        37001: [
          favorite(3700101, "8370011", { display1: "바다정원 카페", memo: "창가 자리" }),
          // No lat/lon: WCONGNAMUL x/y, converted.
          favorite(3700102, "8370012", { lat: undefined, lon: undefined, x: 608064, y: 1159067 }),
        ],
        37002: [
          favorite(3700201, "8370021", { display1: "명동 칼국수", lat: 37.5636, lon: 126.9852 }),
        ],
        37003: [
          favorite(3700301, "8370031", { display1: "해운대 시장", lat: 35.1631, lon: 129.1636 }),
        ],
      },
    };
    const before = Date.now();
    const { runId, lists } = await upload(cookie, read, "u1-full");
    expect(lists).toEqual([
      { externalId: "37001", name: "제주 카페", itemCount: 2 },
      { externalId: "37002", name: "서울 맛집", itemCount: 1 },
      { externalId: "37003", name: "민수의 부산 여행", itemCount: 1 },
    ]);
    const run = await env.DB.prepare(
      "SELECT source, snapshot_at, status, complete, subscription_known FROM import_runs WHERE id = ? AND user_id = ?",
    )
      .bind(runId, user)
      .first<{
        source: string;
        snapshot_at: number;
        status: string;
        complete: number;
        subscription_known: number;
      }>();
    expect(run).toMatchObject({
      source: "kakao_map",
      status: "completed",
      complete: 1,
      subscription_known: 1,
    });
    expect(Math.abs(Number(run?.snapshot_at) - before)).toBeLessThan(1000);

    const pulled = (await (await call("/api/sync/pull", { headers: { cookie } })).json()) as {
      changes: { table: string; row: Record<string, unknown> }[];
    };
    const text = JSON.stringify(pulled);
    for (const id of [
      "l_kakao_37001",
      "l_kakao_37002",
      "l_kakao_37003",
      "p_kakao_8370011",
      "p_kakao_8370021",
    ]) {
      expect(text).toContain(id);
    }
    const place = await env.DB.prepare(
      "SELECT title, lat, lng FROM places WHERE id = 'p_kakao_8370021'",
    ).first<{
      title: string;
      lat: number;
      lng: number;
    }>();
    expect(place).toEqual({ title: "명동 칼국수", lat: 37.5636, lng: 126.9852 });
    const converted = await env.DB.prepare(
      "SELECT lat, lng FROM places WHERE id = 'p_kakao_8370012'",
    ).first<{
      lat: number;
      lng: number;
    }>();
    expect(converted?.lat).toBeCloseTo(37.67127631, 5);
    expect(converted?.lng).toBeCloseTo(127.48995646, 5);
  });

  it("an unchanged upload re-import stays within the write budget", async () => {
    const cookie = await devLogin("km-budget");
    const read: Read = {
      folders: [
        ownFolder(38001, "u1-budget"),
        ownFolder(38002, "u1-budget"),
        ownFolder(38003, "u1-budget"),
      ],
      favorites: {
        38001: Array.from({ length: 500 }, (_, i) => favorite(3800100 + i, `83801${i}`)),
        38002: [favorite(3800201, "8380201"), favorite(3800202, "8380202")],
        38003: [favorite(3800301, "8380301")],
      },
    };
    await upload(cookie, read, "u1-budget");
    // countWrites over D1: `atomic` is one `batch()`, and each statement's rows are `meta.changes`.
    const counted = countingD1(env.DB);
    await upload(cookie, read, "u1-budget", { ...DEV, DB: counted.db });
    const lists = 3;
    const pages = 3;
    expect(counted.written()).toBeGreaterThan(0);
    expect(counted.written()).toBeLessThanOrEqual(10 + 6 * lists + 5 * pages);
  });

  it("the same favourite from kakao-list then Kakao Map is one place", async () => {
    const login = "km-parity";
    const contract = baseContract(login);
    network.use(
      http.get(`${KL}/lists`, () => HttpResponse.json(listsBody(contract))),
      http.get(`${KL}/lists/:folderId/items`, ({ request, params }) =>
        HttpResponse.json(
          itemsBody(
            contract,
            Number(params.folderId),
            Number(new URL(request.url).searchParams.get("offset") ?? 0),
          ),
        ),
      ),
    );
    const cookie = await devLogin(login);
    const started = (await (
      await call("/api/import/runs", post(cookie, { provider: "kakao" }))
    ).json()) as Started;
    for (const l of started.lists) {
      const at = `/api/import/runs/${started.runId}/lists/${l.externalId}`;
      expect((await call(`${at}/pages/0`, post(cookie, {}))).status).toBe(200);
      expect((await call(`${at}/finish`, post(cookie, {}))).status).toBe(200);
    }
    expect(
      (await call(`/api/import/runs/${started.runId}/complete`, post(cookie, {}))).status,
    ).toBe(200);

    const places = await count("SELECT COUNT(*) AS n FROM places");
    const items = await count("SELECT COUNT(*) AS n FROM list_items");
    const pins = await count("SELECT COUNT(*) AS n FROM places WHERE id LIKE 'pin_%'");

    // The raw Kakao Map records kakao-list's mapping turns into that fixture.
    const read: Read = {
      folders: contract.lists.map((l) =>
        l.subscribed
          ? {
              folderid: l.kakaoFolderId,
              title: l.name,
              status: "O",
              subscribe: "Y",
              kakao_map_user_id: "minsu-kakao-map",
              nickname: l.ownerName,
            }
          : ownFolder(l.kakaoFolderId, "parity-acct", { title: l.name }),
      ),
      favorites: Object.fromEntries(
        contract.lists.map((l) => [
          l.kakaoFolderId,
          l.items.map((i) => ({
            seq: Number(i.favoriteSeq),
            key: i.placeKey,
            type: "PLACE",
            display1: i.title,
            display2: i.address,
            lat: i.lat,
            lon: i.lng,
            memo: i.kakaoNote,
            color: i.kakaoColor,
          })),
        ]),
      ),
    };
    const uploaded = await upload(cookie, read, "parity-acct");
    expect(uploaded.lists.map((l) => l.externalId)).toEqual(started.lists.map((l) => l.externalId));
    expect(await count("SELECT COUNT(*) AS n FROM places")).toBe(places);
    expect(await count("SELECT COUNT(*) AS n FROM list_items")).toBe(items);
    expect(await count("SELECT COUNT(*) AS n FROM places WHERE id LIKE 'pin_%'")).toBe(pins);
    expect(
      await count("SELECT COUNT(*) AS n FROM list_items WHERE removed_at_provider IS NOT NULL"),
    ).toBe(0);
  });
});

/** Tests with several full uploads (each a few seconds on a loaded machine). */
const SLOW = 90_000;

describe("another person's list", () => {
  it("her folder in his read makes him a follower, and his sync can't remove it", async () => {
    const she = await devLogin("km-own-she");
    const he = await devLogin("km-own-he");
    const hisId = await userIdOf(he);
    const herId = await userIdOf(she);
    await upload(she, smallRead("u1-own-she", 42001, { title: "그녀의 리스트" }), "u1-own-she");
    // Her folder records its Kakao owner, server-side only.
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lists WHERE id = 'l_kakao_42001' AND provider_owner_id = 'u1-own-she'",
      ),
    ).toBe(1);
    const herPull = JSON.stringify(
      await (await call("/api/sync/pull", { headers: { cookie: she } })).json(),
    );
    expect(herPull).toContain("l_kakao_42001");
    expect(herPull).not.toContain("u1-own-she");
    expect(herPull).not.toContain("providerOwnerId");

    // His read has her folder 42001 (her Kakao Map account owns it) beside his own.
    const claim: Read = {
      folders: [
        ownFolder(42001, "u1-own-she", {
          title: "그녀의 리스트",
          subscribe: "Y",
          nickname: "수지",
        }),
        ownFolder(42002, "u2-own-he", { title: "그의 리스트", nickname: "호세" }),
      ],
      favorites: {
        42001: smallRead("x", 42001).favorites[42001] ?? [],
        42002: [favorite(4200201, "94200201")],
      },
    };
    await upload(he, claim, "u2-own-he");
    const role = (user: string, list = "l_kakao_42001") =>
      env.DB.prepare("SELECT role, removed_at FROM user_lists WHERE user_id = ? AND list_id = ?")
        .bind(user, list)
        .first<{ role: string; removed_at: number | null }>();
    expect(await role(hisId)).toEqual({ role: "follower", removed_at: null });
    expect(await role(hisId, "l_kakao_42002")).toEqual({ role: "owner", removed_at: null });
    expect(await role(herId)).toEqual({ role: "owner", removed_at: null });

    // His next complete sync without it removes it for him only.
    await upload(
      he,
      { folders: [claim.folders[1] as Raw], favorites: claim.favorites },
      "u2-own-he",
    );
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lists WHERE id = 'l_kakao_42001' AND removed_at_provider IS NOT NULL",
      ),
    ).toBe(0);
    expect((await role(hisId))?.removed_at).not.toBeNull();
    expect(await role(herId)).toEqual({ role: "owner", removed_at: null });
  });

  it("a forged read naming his account as the owner of her unrecorded list records nothing", {
    timeout: SLOW,
  }, async () => {
    const she = await devLogin("km-forge-she");
    const he = await devLogin("km-forge-he");
    const herId = await userIdOf(she);
    const hisId = await userIdOf(he);
    const hers = smallRead("u1-forge-she", 42201, { title: "그녀의 리스트" });
    await upload(she, hers, "u1-forge-she");
    // A list from before owner ids were recorded.
    await env.DB.prepare(
      "UPDATE lists SET provider_owner_id = NULL WHERE id = 'l_kakao_42201'",
    ).run();
    // His read lists her folder as his own, unflagged, under his account.
    const forged: Read = {
      folders: [
        ownFolder(42201, "u2-forge-he", { title: "그녀의 리스트", nickname: "호세" }),
        ownFolder(42202, "u2-forge-he", { title: "그의 리스트", nickname: "호세" }),
      ],
      favorites: {
        42201: hers.favorites[42201] ?? [],
        42202: [favorite(4220201, "94220201")],
      },
    };
    await upload(he, forged, "u2-forge-he");
    const ownerId = async () =>
      (
        await env.DB.prepare(
          "SELECT provider_owner_id AS id FROM lists WHERE id = 'l_kakao_42201'",
        ).first<{ id: string | null }>()
      )?.id;
    const role = (user: string) =>
      env.DB.prepare(
        "SELECT role, removed_at FROM user_lists WHERE user_id = ? AND list_id = 'l_kakao_42201'",
      )
        .bind(user)
        .first<{ role: string; removed_at: number | null }>();
    expect(await ownerId()).toBeNull();
    expect(await role(hisId)).toEqual({ role: "follower", removed_at: null });
    expect(await role(herId)).toEqual({ role: "owner", removed_at: null });

    // His next complete sync without it can't remove it for her.
    await upload(
      he,
      { folders: [forged.folders[1] as Raw], favorites: forged.favorites },
      "u2-forge-he",
    );
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lists WHERE id = 'l_kakao_42201' AND removed_at_provider IS NOT NULL",
      ),
    ).toBe(0);
    expect((await role(hisId))?.removed_at).not.toBeNull();
    expect(await role(herId)).toEqual({ role: "owner", removed_at: null });
    // Her next upload records her account.
    await upload(she, hers, "u1-forge-she");
    expect(await ownerId()).toBe("u1-forge-she");
  });

  it("her map_user_id-only account and his map_user_id-only read of her folder match", {
    timeout: SLOW,
  }, async () => {
    const she = await devLogin("km-mapid-she");
    const he = await devLogin("km-mapid-he");
    const herId = await userIdOf(she);
    const mine = (folderid: number): Raw => ({
      folderid,
      title: `리스트 ${folderid}`,
      status: "O",
      subscribe: "N",
      map_user_id: 77001,
      nickname: "수지",
      favorite_cnt: 1,
    });
    const items = (folderid: number) => [favorite(folderid * 10 + 1, `${folderid}01`)];
    // She binds her account (only map_user_id on her folders) through another folder.
    await upload(she, { folders: [mine(42303)], favorites: { 42303: items(42303) } }, "77001");
    // He follows her folder 42301; his read carries only her map_user_id for it.
    await upload(
      he,
      {
        folders: [
          ownFolder(42302, "u2-mapid-he", { nickname: "호세" }),
          {
            folderid: 42301,
            title: "그녀의 리스트",
            status: "O",
            subscribe: "Y",
            map_user_id: 77001,
          },
        ],
        favorites: { 42301: items(42301), 42302: items(42302) },
      },
      "u2-mapid-he",
    );
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lists WHERE id = 'l_kakao_42301' AND provider_owner_id = '77001'",
      ),
    ).toBe(1);
    await upload(
      she,
      {
        folders: [mine(42303), mine(42301)],
        favorites: { 42301: items(42301), 42303: items(42303) },
      },
      "77001",
    );
    const role = await env.DB.prepare(
      "SELECT role FROM user_lists WHERE user_id = ? AND list_id = 'l_kakao_42301'",
    )
      .bind(herId)
      .first<{ role: string }>();
    expect(role?.role).toBe("owner");
  });

  it("a bare map_user_id names her account through its alias; one nobody is bound by records nothing", {
    timeout: SLOW,
  }, async () => {
    const she = await devLogin("km-alias-she");
    const he = await devLogin("km-alias-he");
    const herId = await userIdOf(she);
    const items = (folderid: number) => [favorite(folderid * 10 + 1, `${folderid}01`)];
    // Her folders carry her kakao_map_user_id beside her map_user_id 88001.
    const mine = (folderid: number) => ownFolder(folderid, "u1-alias-she", { map_user_id: 88001 });
    await upload(
      she,
      { folders: [mine(42403)], favorites: { 42403: items(42403) } },
      "u1-alias-she",
    );
    await upload(
      he,
      {
        folders: [
          ownFolder(42404, "u2-alias-he", { nickname: "호세" }),
          {
            folderid: 42401,
            title: "그녀의 리스트",
            status: "O",
            subscribe: "Y",
            map_user_id: 88001,
          },
          {
            folderid: 42402,
            title: "모르는 리스트",
            status: "O",
            subscribe: "Y",
            map_user_id: 99999,
          },
        ],
        favorites: { 42401: items(42401), 42402: items(42402), 42404: items(42404) },
      },
      "u2-alias-he",
    );
    const ownerOf = async (id: string) =>
      (
        await env.DB.prepare("SELECT provider_owner_id AS id FROM lists WHERE id = ?")
          .bind(id)
          .first<{ id: string | null }>()
      )?.id;
    expect(await ownerOf("l_kakao_42401")).toBe("u1-alias-she");
    expect(await ownerOf("l_kakao_42402")).toBeNull();
    await upload(
      she,
      {
        folders: [mine(42403), mine(42401)],
        favorites: { 42401: items(42401), 42403: items(42403) },
      },
      "u1-alias-she",
    );
    const role = await env.DB.prepare(
      "SELECT role FROM user_lists WHERE user_id = ? AND list_id = 'l_kakao_42401'",
    )
      .bind(herId)
      .first<{ role: string }>();
    expect(role?.role).toBe("owner");
  });

  it("an own folder with no owner id in the read is followed", async () => {
    const cookie = await devLogin("km-bare-own");
    const user = await userIdOf(cookie);
    const read: Read = {
      folders: [ownFolder(42101, "u1-bare"), { folderid: 42102, title: "주인 없음", status: "O" }],
      favorites: { 42101: [favorite(4210101, "94210101")], 42102: [favorite(4210201, "94210201")] },
    };
    await upload(cookie, read, "u1-bare");
    const role = await env.DB.prepare(
      "SELECT role FROM user_lists WHERE user_id = ? AND list_id = 'l_kakao_42102'",
    )
      .bind(user)
      .first<{ role: string }>();
    expect(role?.role).toBe("follower");
  });

  it("his bare read of her folder leaves her list alone and makes him a follower", async () => {
    const she = await devLogin("km-bare-she");
    const he = await devLogin("km-bare-he");
    const hisId = await userIdOf(he);
    await upload(
      she,
      smallRead("u1-bare-she", 42201, { title: "Jeju", memo: "제주 맛집" }),
      "u1-bare-she",
    );
    // His newer read has her folder back bare: no title, no owner id, and no favourites.
    const bare: Read = {
      folders: [ownFolder(42202, "u2-bare-he"), { folderid: 42201, subscribe: 1 }],
      favorites: { 42202: [favorite(4220201, "94220201")], 42201: [] },
    };
    await upload(he, bare, "u2-bare-he");
    const list = await env.DB.prepare(
      "SELECT name, description FROM lists WHERE id = 'l_kakao_42201'",
    ).first<{ name: string; description: string | null }>();
    expect(list).toEqual({ name: "Jeju", description: "제주 맛집" });
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM list_items WHERE list_id = 'l_kakao_42201' AND removed_at_provider IS NULL",
      ),
    ).toBe(2);
    const role = await env.DB.prepare(
      "SELECT role, removed_at FROM user_lists WHERE user_id = ? AND list_id = 'l_kakao_42201'",
    )
      .bind(hisId)
      .first<{ role: string; removed_at: number | null }>();
    expect(role).toEqual({ role: "follower", removed_at: null });
  });
});

describe("pages are checked", () => {
  async function openRun(login: string, read: Read, account: string) {
    const cookie = await devLogin(login);
    const started = await startRun(cookie, startBody(read, { confirmAccount: account }));
    expect(started.res.status).toBe(200);
    return { cookie, runId: started.body.runId };
  }
  const send = (cookie: string, url: string, body: unknown) => call(url, post(cookie, body), DEV);

  it("refuses wrong page sizes, missing pages, bad bodies and duplicates; the run stays incomplete", async () => {
    const read = smallRead("u1-pages", 39001);
    const { cookie, runId } = await openRun("km-pages", read, "u1-pages");
    const favs = read.favorites[39001] ?? [];
    const url = pageUrl(runId, "39001", 0);

    const short = await send(cookie, url, { favorites: favs.slice(1) });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "invalid" });
    expect((await send(cookie, url, { favorites: [...favs, favorite(1, "1")] })).status).toBe(400);
    expect((await send(cookie, pageUrl(runId, "39001", 1), { favorites: [] })).status).toBe(404);
    expect((await send(cookie, pageUrl(runId, "39999", 0), { favorites: [] })).status).toBe(404);
    expect((await send(cookie, pageUrl(runId, "not-a-folder", 0), { favorites: [] })).status).toBe(
      404,
    );
    expect((await send(cookie, pageUrl(runId, "39001", -1), { favorites: favs })).status).toBe(404);
    expect((await send(cookie, url, { favorites: "nope" })).status).toBe(400);
    expect((await send(cookie, url, {})).status).toBe(400);
    expect((await send(cookie, url, [favs])).status).toBe(400);
    const notJson = await call(url, { method: "POST", headers: { cookie }, body: "{" }, DEV);
    expect(notJson.status).toBe(400);
    // Two favourites with one seq: kakao-list refuses such a read too.
    const dup = await send(cookie, url, {
      favorites: [favs[0], { ...favs[1], seq: favs[0]?.seq }],
    });
    expect(dup.status).toBe(400);
    expect(await dup.json()).toEqual({ error: "invalid" });

    expect(
      (await call(`/api/import/runs/${runId}/lists/39001/finish`, post(cookie, {}))).status,
    ).toBe(409);
    const complete = await call(`/api/import/runs/${runId}/complete`, post(cookie, {}));
    expect(complete.status).toBe(409);
    expect(await complete.json()).toEqual({ error: "incomplete" });
  });

  it("refuses a body over 1 MB, with or without a truthful content-length", async () => {
    const read = smallRead("u1-big", 39101);
    const { cookie, runId } = await openRun("km-big", read, "u1-big");
    const url = pageUrl(runId, "39101", 0);
    const huge = JSON.stringify({ favorites: [{ display1: "x".repeat(1_100_000) }, {}] });

    const big = await call(url, post(cookie, JSON.parse(huge)), DEV);
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "too_large" });

    // A content-length that understates the body doesn't let it through.
    const lying = await call(
      url,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "content-length": "100" },
        body: huge,
      },
      DEV,
    );
    expect(lying.status).toBe(413);

    // A big declared length is refused before the body is read.
    const claimed = await call(
      url,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "content-length": "2000000" },
        body: "{}",
      },
      DEV,
    );
    expect(claimed.status).toBe(413);

    // No content-length: a streamed body is counted while it is read.
    const bytes = new TextEncoder().encode(huge);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 64 * 1024)
          controller.enqueue(bytes.slice(i, i + 64 * 1024));
        controller.close();
      },
    });
    const streamed = await call(
      url,
      { method: "POST", headers: { cookie, "content-type": "application/json" }, body: stream },
      DEV,
    );
    expect(streamed.status).toBe(413);

    // The start route has the same limit.
    const start = await call(
      RUNS,
      post(cookie, { folders: [{ title: "x".repeat(1_100_000) }], counts: [] }),
      DEV,
    );
    expect(start.status).toBe(413);

    // Nothing was imported.
    const complete = await call(`/api/import/runs/${runId}/complete`, post(cookie, {}));
    expect(complete.status).toBe(409);
  });

  it("checks the counts against the folders", async () => {
    const cookie = await devLogin("km-counts");
    const read = smallRead("u1-counts", 39201);
    const user = await userIdOf(cookie);
    // A folder with no counts entry.
    const missing = await startRun(cookie, {
      folders: read.folders,
      counts: [],
      confirmAccount: "u1-counts",
    });
    expect(missing.res.status).toBe(400);
    expect(missing.body).toEqual({ error: "invalid" });
    // A counts entry for a folder the read doesn't have (or a deleted one).
    for (const extra of [99999, 39202]) {
      const unknown = await startRun(cookie, {
        folders: [...read.folders, { folderid: 39202, status: "D" }],
        counts: [
          { folderid: 39201, itemCount: 2 },
          { folderid: extra, itemCount: 1 },
        ],
        confirmAccount: "u1-counts",
      });
      expect(unknown.res.status).toBe(400);
    }
    // The same folder counted twice.
    const twice = await startRun(cookie, {
      folders: read.folders,
      counts: [
        { folderid: 39201, itemCount: 2 },
        { folderid: 39201, itemCount: 3 },
      ],
      confirmAccount: "u1-counts",
    });
    expect(twice.res.status).toBe(400);
    // Free text over the import text limit, and a malformed start body.
    const longText = await startRun(cookie, {
      folders: read.folders,
      counts: [{ folderid: 39201, itemCount: 2, firstDisplay2: "가".repeat(5001) }],
      confirmAccount: "u1-counts",
    });
    expect(longText.res.status).toBe(400);
    expect((await startRun(cookie, { folders: "x", counts: [] })).res.status).toBe(400);
    expect((await startRun(cookie, { ...startBody(read), confirmAccount: "" })).res.status).toBe(
      400,
    );
    expect(await runsOf(user)).toBe(0);
    expect(await bindingOf(user)).toBeNull();
  });

  it("an upload page can't feed a kakao-list run, nor another user's run", async () => {
    const login = "km-cross";
    const contract = baseContract(login);
    network.use(http.get(`${KL}/lists`, () => HttpResponse.json(listsBody(contract))));
    const cookie = await devLogin(login);
    const started = (await (
      await call("/api/import/runs", post(cookie, { provider: "kakao" }))
    ).json()) as Started;
    const res = await send(cookie, pageUrl(started.runId, "101", 0), {
      favorites: [favorite(1, "1"), favorite(2, "2")],
    });
    expect(res.status).toBe(404);

    const read = smallRead("u1-cross", 39301);
    const own = await openRun("km-cross-owner", read, "u1-cross");
    // Nor does kakao-list's page route serve an upload run.
    expect(
      (await call(`/api/import/runs/${own.runId}/lists/39301/pages/0`, post(own.cookie, {})))
        .status,
    ).toBe(404);
    const stranger = await devLogin("km-cross-stranger");
    expect(
      (await send(stranger, pageUrl(own.runId, "39301", 0), { favorites: read.favorites[39301] }))
        .status,
    ).toBe(404);
  });

  it("a page imports and says when the list is done", async () => {
    const read = smallRead("u1-done", 39401);
    const { cookie, runId } = await openRun("km-done", read, "u1-done");
    const res = await send(cookie, pageUrl(runId, "39401", 0), {
      favorites: read.favorites[39401],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ placesAdded: 2, done: true });
  });
});

/** A D1 binding that sums `meta.changes` over `batch()` (what `Db.atomic` runs on D1). */
function countingD1(d1: D1Database): { db: D1Database; written(): number } {
  let total = 0;
  const db = new Proxy(d1, {
    get(target, prop) {
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          for (const r of results) total += r.meta?.changes ?? 0;
          return results;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, written: () => total };
}
