import { describe, expect, it } from "vitest";
import { importItemSchema, importListMetaSchema } from "../importContract";
import { LIMITS } from "../limits";
import { kakaoListParity } from "./kakaoListParity.fixture";
import {
  KakaoAccountUnclearError,
  type KakaoMapStart,
  KakaoSignedOutError,
  kakaoMapItemsToImport,
  kakaoMapListsToImport,
  kakaoMapStartSchema,
} from "./kakaoMap";
import { KAKAO_FAVORITE_FIELDS, KAKAO_FOLDER_FIELDS } from "./kakaoMapFields";

const LOGIN = "9001";

// Synthetic raw records, shaped like docs/kakao-map-access.md. Coordinates: WCONGNAMUL x/y, and
// for one favourite Kakao's own lat/lon for the same point (rounded to 7 decimals).
const folders: unknown[] = [
  {
    folderid: 0,
    title: "기본 폴더",
    kakao_map_user_id: "u1",
    map_user_id: 1,
    nickname: "Me",
    favorite_cnt: 2,
  },
  {
    folderid: 101,
    title: " Seoul eats ",
    memo: "",
    kakao_map_user_id: "u1",
    map_user_id: 1,
    favorite_cnt: 4,
    folder_updated_at: "2026-11-01T00:00:00Z",
  },
  // Own and public: Kakao flags it with `subscribe` too.
  {
    folderid: 102,
    title: "Public picks",
    memo: " Shared with friends ",
    kakao_map_user_id: "u1",
    map_user_id: 1,
    nickname: "Me",
    subscribe: "Y",
    favorite_cnt: 1,
  },
  // Own, with only the numeric map_user_id.
  { folderid: 103, title: "Old ids", map_user_id: 1, favorite_cnt: 2 },
  {
    folderid: 201,
    title: "Bap's Jeju",
    kakao_map_user_id: "u2",
    map_user_id: 2,
    nickname: "Bap",
    subscribe: "Y",
    favorite_cnt: 1,
  },
  { folderid: 104, title: "Gone", status: "D", kakao_map_user_id: "u1", favorite_cnt: 0 },
  // The same folder again, with less metadata.
  { folderid: 101, kakao_map_user_id: "u1" },
  // A followed folder that comes back bare (docs/kakao-map-access.md section 6).
  { folderid: 301, subscribe: 1 },
  // Followed, without a nickname: ownerName falls back to kakao_map_user_id.
  { folderid: 202, title: "No nickname", kakao_map_user_id: "u3", subscribe: "Y" },
  // Followed, with only map_user_id: ownerName falls back to "map:<id>".
  { folderid: 203, title: "Only map id", map_user_id: 4, subscribe: "Y" },
  // Two records of one folder with equal metadata scores: the later one wins.
  { folderid: 106, title: "Tie first", memo: "first memo", kakao_map_user_id: "u1" },
  { folderid: 106, title: "Tie second", memo: "second memo", kakao_map_user_id: "u1" },
  // Not a usable folder id.
  { folderid: "105", title: "String id", kakao_map_user_id: "u1" },
];

const longMemo = "가".repeat(LIMITS.importText + 50);

const favorites: Record<string, unknown[]> = {
  "0": [
    {
      seq: 1001,
      type: "PLACE",
      key: "11111",
      display1: " Cafe One ",
      display2: "Seoul Jongno ",
      x: 497000,
      y: 1129000,
      color: "01",
      memo: " good coffee ",
    },
    {
      seq: 1002,
      type: "ADDRESS",
      key: "N34923295",
      display1: "Home street",
      display2: "Seoul Mapo",
      x: 497000,
      y: 1129000,
    },
  ],
  "101": [
    {
      seq: 2001,
      type: "POINT",
      key: "P2001",
      display1: "Meeting point",
      display2: "Gangnam station exit 2",
      x: 512300,
      y: 1110700,
      color: "03",
    },
    { seq: 2002, type: "ROUTE_BICYCLE", key: "R2002", display1: "Han river ride" },
    { seq: 2003, key: "22222", display1: "Untyped place", display2: "", x: 497000, y: 1129000 },
    {
      seq: 2004,
      type: "PLACE",
      key: "33333",
      display1: "Lat lon place",
      x: 512300,
      y: 1110700,
      lat: 37.4979675,
      lon: 127.0556386,
    },
    // kakao-list stores neither type (over 40 characters; a control character): both untyped.
    { seq: 2005, type: "T".repeat(41), key: "77777", display1: "Long type" },
    { seq: 2006, type: "PLA\nCE", key: "88888", display1: "Control type" },
  ],
  "102": [{ seq: 3001, type: "PLACE", key: "44444", display1: "Jeju south", x: 480500, y: -20500 }],
  "103": [
    { type: "PLACE", key: "55555", display1: "No seq", x: 497000, y: 1129000 },
    { type: "POINT", display1: "" },
  ],
  "201": [
    {
      seq: 4001,
      type: "PLACE",
      key: "66666",
      display1: "Bap's favourite",
      display2: "Jeju city",
      x: 480500,
      y: -20500,
      memo: "  try the noodles  ",
    },
  ],
  "301": [],
  "202": [],
  "203": [],
  "106": [],
};

/** The `start` the extension builds from a read (apps/extension/src/readInPage.ts). */
function startOf(rawFolders: unknown[], rawFavorites: Record<string, unknown[]>): KakaoMapStart {
  const ids: number[] = [];
  for (const record of rawFolders) {
    if (!record || typeof record !== "object") continue;
    const { folderid, status } = record as { folderid?: unknown; status?: unknown };
    if (typeof folderid !== "number" || status === "D") continue;
    if (!ids.includes(folderid)) ids.push(folderid);
  }
  return {
    folders: rawFolders,
    counts: ids.map((folderid) => {
      const list = rawFavorites[String(folderid)] ?? [];
      const first = list[0] as { display2?: unknown } | undefined;
      return typeof first?.display2 === "string"
        ? { folderid, itemCount: list.length, firstDisplay2: first.display2 }
        : { folderid, itemCount: list.length };
    }),
  };
}

const start = startOf(folders, favorites);
const own = (extra: Record<string, unknown> = {}) => ({ kakao_map_user_id: "u1", ...extra });

describe("kakaoMapListsToImport / kakaoMapItemsToImport", () => {
  it("parity: lists match kakao-list's mapping", () => {
    const expected = kakaoListParity(folders, favorites, LOGIN).lists;
    const { lists } = kakaoMapListsToImport(start, LOGIN);
    expect(lists).toEqual(expected);
    expect(lists.map((l) => l.externalId)).toEqual([
      `0~${LOGIN}`,
      "101",
      "102",
      "103",
      "201",
      "301",
      "202",
      "203",
      "106",
    ]);
    for (const list of lists) importListMetaSchema.parse(list);
    const byId = new Map(lists.map((l) => [l.externalId, l]));
    expect(byId.get("202")?.ownerName).toBe("u3");
    expect(byId.get("203")?.ownerName).toBe("map:4");
    expect(byId.get("106")).toMatchObject({ name: "Tie second", description: "second memo" });
  });

  it("parity: lists take itemCount from counts", () => {
    const counted: KakaoMapStart = {
      ...start,
      counts: start.counts.map((c) => (c.folderid === 101 ? { ...c, itemCount: 444 } : c)),
    };
    const list = kakaoMapListsToImport(counted, LOGIN).lists.find((l) => l.externalId === "101");
    expect(list?.itemCount).toBe(444);
  });

  it("parity: items match kakao-list's mapping", () => {
    const expected = kakaoListParity(folders, favorites, LOGIN).items;
    expect(Object.keys(expected).sort()).toEqual([
      "0",
      "101",
      "102",
      "103",
      "106",
      "201",
      "202",
      "203",
      "301",
    ]);
    for (const [folderid, want] of Object.entries(expected)) {
      const got = kakaoMapItemsToImport(Number(folderid), 0, favorites[folderid] ?? []);
      expect(got).toHaveLength(want.length);
      got.forEach((item, i) => {
        const w = want[i];
        const fields = (x: typeof item | undefined) => ({
          externalId: x?.externalId,
          placeExternalId: x?.placeExternalId,
          title: x?.title,
          address: x?.address,
          providerNote: x?.providerNote,
          providerColor: x?.providerColor,
          position: x?.position,
        });
        expect(fields(item)).toEqual(fields(w));
        expect(item.lat === undefined).toBe(w?.lat === undefined);
        expect(item.lng === undefined).toBe(w?.lng === undefined);
        if (item.lat !== undefined) expect(Math.abs(item.lat - (w?.lat ?? 0))).toBeLessThan(1e-6);
        if (item.lng !== undefined) expect(Math.abs(item.lng - (w?.lng ?? 0))).toBeLessThan(1e-6);
      });
    }
  });

  it("prefers Kakao's own lat/lon", () => {
    const [, , , latLon] = kakaoMapItemsToImport(101, 0, favorites["101"] ?? []);
    expect(latLon?.lat).toBe(37.4979675);
    expect(latLon?.lng).toBe(127.0556386);
  });

  it("keeps a negative y", () => {
    const [jeju] = kakaoMapItemsToImport(102, 0, favorites["102"] ?? []);
    expect(jeju?.lat).toBeCloseTo(33.4196879, 6);
    expect(jeju?.lng).toBeCloseTo(126.9161365, 6);
  });

  it("folder 0 is per person", () => {
    const { lists } = kakaoMapListsToImport(start, LOGIN);
    expect(lists[0]?.externalId).toBe(`0~${LOGIN}`);
    expect(kakaoMapListsToImport(start, "other").lists[0]?.externalId).toBe("0~other");
    for (const list of lists.slice(1)) expect(list.externalId).toMatch(/^[1-9]\d*$/);
  });

  it("ADDRESS is a place, routes and points are not", () => {
    const [, address] = kakaoMapItemsToImport(0, 0, favorites["0"] ?? []);
    expect(address?.placeExternalId).toBe("N34923295");
    const [point, route, untyped, , longType, controlType] = kakaoMapItemsToImport(
      101,
      0,
      favorites["101"] ?? [],
    );
    expect(point?.placeExternalId).toBeUndefined();
    expect(longType?.placeExternalId).toBe("77777");
    expect(controlType?.placeExternalId).toBe("88888");
    expect(point?.lat).toBeDefined();
    expect(route?.placeExternalId).toBeUndefined();
    expect(route?.lat).toBeUndefined();
    expect(route?.lng).toBeUndefined();
    expect(untyped?.placeExternalId).toBe("22222");
  });

  it("item ids and titles fall back like kakao-list", () => {
    const [noSeq, neither] = kakaoMapItemsToImport(103, 0, favorites["103"] ?? []);
    expect(noSeq?.externalId).toBe("55555");
    expect(neither?.externalId).toBe("103-1");
    expect(neither?.title).toBe("Saved place 2");
    expect(neither?.lat).toBeUndefined();
  });

  it("zero folders throws KakaoSignedOutError", () => {
    expect(() => kakaoMapListsToImport({ folders: [], counts: [] }, LOGIN)).toThrow(
      KakaoSignedOutError,
    );
    const deleted = [own({ folderid: 0, status: "D" }), own({ folderid: 5, status: "D" })];
    expect(() => kakaoMapListsToImport(startOf(deleted, {}), LOGIN)).toThrow(KakaoSignedOutError);
  });

  it("offset numbers positions and fallbacks across pages", () => {
    const page = Array.from({ length: 100 }, () => ({ type: "POINT" }));
    const items = kakaoMapItemsToImport(777, 500, page);
    expect(items.map((i) => i.position)).toEqual(Array.from({ length: 100 }, (_, i) => 500 + i));
    expect(items[0]?.title).toBe("Saved place 501");
    expect(items[0]?.externalId).toBe("777-500");
    expect(items[99]?.externalId).toBe("777-599");
  });

  it("own account", () => {
    const result = kakaoMapListsToImport(start, LOGIN);
    expect(result.account).toEqual({ kakaoMapUserId: "u1", nickname: "Me" });
    expect(result.subscriptionKnown).toBe(true);
    const byId = new Map(result.lists.map((l) => [l.externalId, l]));
    expect(byId.get("102")?.followed).toBe(false);
    expect(result.lists.filter((l) => l.followed).map((l) => l.externalId)).toEqual([
      "201",
      "301",
      "202",
      "203",
    ]);
    expect(byId.get("201")?.ownerName).toBe("Bap");
    for (const l of result.lists) if (!l.followed) expect(l.ownerName).toBeUndefined();

    const numericOnly = [
      { folderid: 0, map_user_id: 1 },
      { folderid: 7, map_user_id: 1, title: "Mine" },
    ];
    expect(kakaoMapListsToImport(startOf(numericOnly, {}), LOGIN).account).toEqual({
      kakaoMapUserId: "1",
    });
  });

  it("names each list's Kakao owner: the folder's account, joined to hers only for her folders", () => {
    const { providerOwnerIds, mapOwnerIds } = kakaoMapListsToImport(start, LOGIN);
    expect(Object.fromEntries(providerOwnerIds)).toEqual({
      [`0~${LOGIN}`]: "u1",
      "101": "u1",
      "102": "u1",
      // Her own folder with only map_user_id: her account, through her other folders.
      "103": "u1",
      "106": "u1",
      "201": "u2",
      "202": "u3",
    });
    // A followed folder with only map_user_id: that id is kept apart, since it may not be the id
    // its owner's account is bound by (the server matches it against bindings, or drops it).
    expect(Object.fromEntries(mapOwnerIds)).toEqual({ "203": "4" });
    // A bare folder names no owner.
    expect(providerOwnerIds.has("301")).toBe(false);
    const bareOwn = [own({ folderid: 0 }), { folderid: 8, title: "No ids" }];
    expect(kakaoMapListsToImport(startOf(bareOwn, {}), LOGIN).providerOwnerIds.has("8")).toBe(
      false,
    );
    // An id too long to keep whole names no owner.
    const longOwner = [
      own({ folderid: 0 }),
      { folderid: 9, kakao_map_user_id: "x".repeat(201), subscribe: "Y" },
    ];
    expect(kakaoMapListsToImport(startOf(longOwner, {}), LOGIN).providerOwnerIds.has("9")).toBe(
      false,
    );
  });

  it("names the map_user_id seen beside her account on her own folders as its alias", () => {
    expect(kakaoMapListsToImport(start, LOGIN).accountAlias).toBe("1");
    // Her map_user_id-only account has no alias: its id is the map_user_id.
    const numericOnly = [
      { folderid: 0, map_user_id: 1 },
      { folderid: 7, map_user_id: 1, title: "Mine" },
    ];
    expect(kakaoMapListsToImport(startOf(numericOnly, {}), LOGIN).accountAlias).toBeUndefined();
    // Two map_user_ids beside her account: unclear, so no alias.
    const two = [
      { folderid: 0, kakao_map_user_id: "u1", map_user_id: 1 },
      { folderid: 7, kakao_map_user_id: "u1", map_user_id: 2 },
    ];
    expect(kakaoMapListsToImport(startOf(two, {}), LOGIN).accountAlias).toBeUndefined();
    // A pairing seen only on a followed folder isn't hers.
    const followedPair = [
      { folderid: 0, kakao_map_user_id: "u1" },
      { folderid: 7, kakao_map_user_id: "u2", map_user_id: 2, subscribe: "Y" },
    ];
    expect(kakaoMapListsToImport(startOf(followedPair, {}), LOGIN).accountAlias).toBeUndefined();
  });

  it("a bare followed folder is followed, with kakao-list's fallback name", () => {
    const bare = kakaoMapListsToImport(start, LOGIN).lists.find((l) => l.externalId === "301");
    expect(bare).toEqual({ externalId: "301", name: "Folder 301", followed: true, itemCount: 0 });
    // Also when it is the only flagged folder.
    const only = [own({ folderid: 0 }), { folderid: 9, subscribe: 1 }];
    const lists = kakaoMapListsToImport(startOf(only, {}), LOGIN).lists;
    expect(lists.find((l) => l.externalId === "9")?.followed).toBe(true);
  });

  it("marks a bare followed folder (no owner id, no title) as bare, and nothing else", () => {
    // Folder 301 is followed with neither an owner id nor a title: the read can't vouch for the
    // shared list's name or contents, only that she follows it.
    expect([...kakaoMapListsToImport(start, LOGIN).bareFolders]).toEqual(["301"]);
    const mixed = [
      own({ folderid: 0 }),
      // Followed with a title but no owner id, or an owner id but no title: not bare.
      { folderid: 5, title: "Named", subscribe: 1 },
      { folderid: 6, kakao_map_user_id: "u9", subscribe: 1 },
      // Her own folder with no ids and no title: not followed, so not bare.
      { folderid: 7 },
      { folderid: 8, subscribe: 1, title: "  " },
    ];
    expect([...kakaoMapListsToImport(startOf(mixed, {}), LOGIN).bareFolders]).toEqual(["8"]);
  });

  it("a map_user_id-only folder joins her account only through her own folders", () => {
    const joined = [
      { folderid: 0, kakao_map_user_id: "u1", map_user_id: 1 },
      { folderid: 3, map_user_id: 1 },
    ];
    expect(kakaoMapListsToImport(startOf(joined, {}), LOGIN).account.kakaoMapUserId).toBe("u1");
    // (a) Two people: one whose map_user_id happens to equal the other's kakao_map_user_id.
    const twoPeople = [
      { folderid: 0, kakao_map_user_id: "7", map_user_id: 3 },
      { folderid: 5, kakao_map_user_id: "3" },
    ];
    // (b) The pairing seen only on a flagged folder doesn't vouch for her map_user_id folder.
    const flaggedPair = [
      { folderid: 0, kakao_map_user_id: "u1" },
      { folderid: 5, map_user_id: 9 },
      { folderid: 6, kakao_map_user_id: "u1", map_user_id: 9, subscribe: "Y" },
    ];
    // (c) One map_user_id paired with two different kakao ids.
    const twoPairs = [
      { folderid: 0, kakao_map_user_id: "u1", map_user_id: 1 },
      { folderid: 5, kakao_map_user_id: "u2", map_user_id: 1 },
      { folderid: 6, map_user_id: 1 },
    ];
    for (const bad of [twoPeople, flaggedPair, twoPairs]) {
      expect(() => kakaoMapListsToImport(startOf(bad, {}), LOGIN)).toThrow(
        KakaoAccountUnclearError,
      );
    }
  });

  it("unclear account throws", () => {
    const noUnflagged = [own({ folderid: 0, subscribe: "Y" })];
    const noOwnerId = [{ folderid: 0, title: "x" }, own({ folderid: 3, subscribe: "Y" })];
    const twoOwners = [own({ folderid: 0 }), { folderid: 4, kakao_map_user_id: "u9" }];
    for (const bad of [noUnflagged, noOwnerId, twoOwners]) {
      expect(() => kakaoMapListsToImport(startOf(bad, {}), LOGIN)).toThrow(
        KakaoAccountUnclearError,
      );
    }
  });

  it("oversized text is cut, not rejected", () => {
    const raw = [
      {
        seq: 1,
        type: "PLACE",
        key: "k1",
        display1: "t".repeat(LIMITS.importTitle + 10),
        display2: "a".repeat(LIMITS.importText + 10),
        memo: longMemo,
        color: "c".repeat(60),
      },
    ];
    const [item] = kakaoMapItemsToImport(5, 0, raw);
    expect(item?.providerNote).toHaveLength(LIMITS.importText);
    expect(item?.title).toHaveLength(LIMITS.importTitle);
    expect(item?.address).toHaveLength(LIMITS.importText);
    expect(item?.providerColor).toHaveLength(40);
    for (const folderid of Object.keys(favorites)) {
      for (const i of kakaoMapItemsToImport(Number(folderid), 0, favorites[folderid] ?? [])) {
        importItemSchema.parse(i);
      }
    }
    importItemSchema.parse(item);

    const longFolders = [
      own({ folderid: 0, title: "n".repeat(LIMITS.importTitle + 5), memo: longMemo }),
      {
        folderid: 8,
        subscribe: "Y",
        kakao_map_user_id: "u2",
        nickname: "b".repeat(LIMITS.importTitle + 5),
      },
    ];
    const { lists } = kakaoMapListsToImport(startOf(longFolders, {}), LOGIN);
    expect(lists[0]?.name).toHaveLength(LIMITS.importTitle);
    expect(lists[0]?.description).toHaveLength(LIMITS.importText);
    expect(lists[1]?.ownerName).toHaveLength(LIMITS.importTitle);
    for (const list of lists) importListMetaSchema.parse(list);
  });

  it("bad records never throw", () => {
    const odd: unknown[] = [
      null,
      "folder",
      { folderid: Number.NaN },
      { folderid: -1 },
      { folderid: 1.5 },
      own({ folderid: 0, title: 42, memo: {}, nickname: 7 }),
      { folderid: 6, subscribe: "Y", kakao_map_user_id: 3, nickname: [] },
    ];
    const { lists } = kakaoMapListsToImport(startOf(odd, {}), LOGIN);
    expect(lists.map((l) => l.externalId)).toEqual([`0~${LOGIN}`, "6"]);
    expect(lists[0]?.name).toBe("Folder 0");

    const items = kakaoMapItemsToImport(6, 0, [
      null,
      "x",
      42,
      [],
      { seq: {}, key: 5, display1: 9, type: 3, x: "1", lat: "37" },
      { seq: "", key: "" },
      { seq: "s".repeat(300) },
    ]);
    expect(items.map((i) => i.externalId)).toEqual([
      "6-0",
      "6-1",
      "6-2",
      "6-3",
      "6-4",
      "6-5",
      "6-6",
    ]);
    expect(items[0]?.title).toBe("Saved place 1");
    for (const i of items) importItemSchema.parse(i);
  });

  it("validates the start", () => {
    expect(kakaoMapStartSchema.safeParse(start).success).toBe(true);
    expect(
      kakaoMapStartSchema.safeParse({ folders: Array.from({ length: 2001 }), counts: [] }).success,
    ).toBe(false);
    expect(
      kakaoMapStartSchema.safeParse({
        folders: [],
        counts: Array.from({ length: LIMITS.importLists + 1 }, (_, i) => ({
          folderid: i,
          itemCount: 0,
        })),
      }).success,
    ).toBe(false);
    expect(
      kakaoMapStartSchema.safeParse({ folders: [], counts: [{ folderid: -1, itemCount: 0 }] })
        .success,
    ).toBe(false);
  });
});

// The extension sends only KAKAO_FAVORITE_FIELDS / KAKAO_FOLDER_FIELDS of each record
// (apps/extension/src/readInPage.ts, whose test checks its copy of the lists against these).
describe("the fields the extension sends", () => {
  /** What readInPage sends of a record: only `fields`, values unchanged; null for a non-record. */
  const keepOnly = (value: unknown, fields: readonly string[]): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const kept: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.hasOwn(value, field)) kept[field] = (value as Record<string, unknown>)[field];
    }
    return kept;
  };
  const sentFolders = (records: unknown[]) => records.map((r) => keepOnly(r, KAKAO_FOLDER_FIELDS));
  const sentFavorites = (byFolder: Record<string, unknown[]>) =>
    Object.fromEntries(
      Object.entries(byFolder).map(([folderid, list]) => [
        folderid,
        list.map((f) => keepOnly(f, KAKAO_FAVORITE_FIELDS)),
      ]),
    );

  // The fixtures above with fields magomap never reads, and records that aren't records.
  const route_form = { points: [{ x: 497000, y: 1129000 }] };
  const noisyFolders: unknown[] = folders.map((f) =>
    f && typeof f === "object" ? { ...f, icon: "star", created_at: "2026-01-01", share: {} } : f,
  );
  const noisyFavorites: Record<string, unknown[]> = Object.fromEntries(
    Object.entries(favorites).map(([folderid, list]) => [
      folderid,
      list.map((f) =>
        f && typeof f === "object"
          ? { ...f, route_form, folderid: Number(folderid), item_updated_at: "2026-01-01" }
          : f,
      ),
    ]),
  );
  const oddFolders: unknown[] = [
    ...noisyFolders,
    null,
    "folder",
    [{ folderid: 7 }],
    { folderid: 6, subscribe: "Y", kakao_map_user_id: 3, nickname: [], title: 42, memo: {} },
  ];
  const oddFavorites: Record<string, unknown[]> = {
    ...noisyFavorites,
    "6": [
      null,
      "x",
      42,
      [],
      { seq: {}, key: 5, display1: 9, type: 3, x: "1", lat: "37", route_form },
      { seq: "", key: "" },
      { seq: "s".repeat(300) },
    ],
  };
  // kakao-list's mapping throws on records that aren't records, so parity skips the odd ones.
  const fixtures: [string, unknown[], Record<string, unknown[]>, boolean][] = [
    ["the adapter's fixtures", folders, favorites, true],
    ["with fields magomap doesn't read", noisyFolders, noisyFavorites, true],
    ["with records that aren't records", oddFolders, oddFavorites, false],
  ];

  for (const [name, rawFolders, rawFavorites, parity] of fixtures) {
    it(`gives the same lists and items as the raw records: ${name}`, () => {
      const projectedFolders = sentFolders(rawFolders);
      const projectedFavorites = sentFavorites(rawFavorites);
      const raw = kakaoMapListsToImport(startOf(rawFolders, rawFavorites), LOGIN);
      const sent = kakaoMapListsToImport(startOf(projectedFolders, projectedFavorites), LOGIN);
      expect(sent).toEqual(raw);
      expect(raw.lists.length).toBeGreaterThan(0);
      for (const [folderid, list] of Object.entries(rawFavorites)) {
        const sentList = projectedFavorites[folderid] ?? [];
        expect(kakaoMapItemsToImport(Number(folderid), 0, sentList)).toEqual(
          kakaoMapItemsToImport(Number(folderid), 0, list),
        );
        // A later page too: positions and fallback ids count from its offset.
        expect(kakaoMapItemsToImport(Number(folderid), 500, sentList)).toEqual(
          kakaoMapItemsToImport(Number(folderid), 500, list),
        );
      }
    });

    if (parity) {
      it(`gives kakao-list's mapping the same result too: ${name}`, () => {
        const sent = kakaoListParity(sentFolders(rawFolders), sentFavorites(rawFavorites), LOGIN);
        expect(sent).toEqual(kakaoListParity(rawFolders, rawFavorites, LOGIN));
        expect(Object.keys(sent.items).length).toBeGreaterThan(0);
      });
    }
  }

  it("the adapter reads no other field of a record", () => {
    // Every property the adapter looks at, on records that carry fields it must not need.
    const read = { folder: new Set<string>(), favorite: new Set<string>() };
    const watched = (kind: keyof typeof read) => (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const note = (key: string | symbol) => {
        if (typeof key === "string") read[kind].add(key);
      };
      return new Proxy(value, {
        get(target, key, receiver) {
          note(key);
          return Reflect.get(target, key, receiver);
        },
        has(target, key) {
          note(key);
          return Reflect.has(target, key);
        },
        getOwnPropertyDescriptor(target, key) {
          note(key);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        ownKeys(target) {
          note("(every key)");
          return Reflect.ownKeys(target);
        },
      });
    };
    for (const [, rawFolders, rawFavorites] of fixtures) {
      const watchedFolders = rawFolders.map(watched("folder"));
      kakaoMapListsToImport(startOf(watchedFolders, {}), LOGIN);
      for (const [folderid, list] of Object.entries(rawFavorites)) {
        kakaoMapItemsToImport(Number(folderid), 0, list.map(watched("favorite")));
      }
    }
    // startOf (the extension's own code) reads folderid and status; both are kept.
    expect([...read.folder].filter((key) => !KAKAO_FOLDER_FIELDS.includes(key))).toEqual([]);
    expect([...read.favorite].filter((key) => !KAKAO_FAVORITE_FIELDS.includes(key))).toEqual([]);
    // It does read them: the lists aren't longer than needed either.
    expect([...read.folder].sort()).toEqual([...KAKAO_FOLDER_FIELDS].sort());
    expect([...read.favorite].sort()).toEqual([...KAKAO_FAVORITE_FIELDS].sort());
  });
});
