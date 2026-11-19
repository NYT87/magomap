import { describe, expect, it } from "vitest";
import {
  importedNoteRowId,
  newId,
  ownItemRowId,
  pinRowId,
  placeRowId,
  providerItemRowId,
  providerListRowId,
  userListRowId,
  userPlaceRowId,
} from "./ids";
import { mutationRowSchemas, pushEnvelopeSchema, searchSignaturePayload } from "./sync";

const mutation = (i: number, table = "visit_notes") => ({
  mutationId: `m${i}`,
  table,
  op: "upsert",
  id: `n${i}`,
  row: {},
  clientUpdatedAt: 1,
});

const now = 1_763_000_000_000;
const baseRow = { createdAt: now, updatedAt: now, deletedAt: null };

describe("push envelope", () => {
  it("rejects an empty push", () => {
    expect(pushEnvelopeSchema.safeParse({ mutations: [] }).success).toBe(false);
  });

  it("rejects more than 200 mutations", () => {
    const mutations = Array.from({ length: 201 }, (_, i) => mutation(i));
    expect(pushEnvelopeSchema.safeParse({ mutations }).success).toBe(false);
  });

  it("accepts 200 mutations", () => {
    const mutations = Array.from({ length: 200 }, (_, i) => mutation(i));
    expect(pushEnvelopeSchema.safeParse({ mutations }).success).toBe(true);
  });

  it("rejects writes to place_locations", () => {
    expect(
      pushEnvelopeSchema.safeParse({ mutations: [mutation(1, "place_locations")] }).success,
    ).toBe(false);
  });
});

describe("row schemas", () => {
  it("rejects a javascript: link", () => {
    const row = {
      ...baseRow,
      id: "l1",
      placeId: "p_kakao_1",
      url: "javascript:alert(1)",
      title: null,
    };
    expect(mutationRowSchemas.links.safeParse(row).success).toBe(false);
  });

  it("accepts an https link", () => {
    const row = {
      ...baseRow,
      id: newId(),
      placeId: "p_kakao_1",
      url: "https://example.com/a",
      title: null,
    };
    expect(mutationRowSchemas.links.safeParse(row).success).toBe(true);
  });

  it("rejects an impossible visit date", () => {
    const row = {
      ...baseRow,
      id: "n1",
      placeId: "p_kakao_1",
      visitedOn: "2026-13-01",
      body: "hi",
      origin: "user",
      originKey: null,
      editedByUser: false,
    };
    expect(mutationRowSchemas.visit_notes.safeParse(row).success).toBe(false);
  });

  it("accepts a valid visit note", () => {
    const row = {
      ...baseRow,
      id: newId(),
      placeId: "p_kakao_1",
      visitedOn: "2026-11-19",
      body: "창가 자리에서 바다가 보였어요.",
      origin: "user",
      originKey: null,
      editedByUser: false,
    };
    expect(mutationRowSchemas.visit_notes.safeParse(row).success).toBe(true);
  });

  it("rejects a visit note body over 20,000 characters", () => {
    const row = {
      ...baseRow,
      id: newId(),
      placeId: "p_kakao_1",
      visitedOn: null,
      body: "가".repeat(20_001),
      origin: "user",
      originKey: null,
      editedByUser: false,
    };
    expect(mutationRowSchemas.visit_notes.safeParse(row).success).toBe(false);
  });
});

describe("ids", () => {
  it("builds the deterministic, provider-neutral ids", () => {
    expect(placeRowId("kakao", "27324155")).toBe("p_kakao_27324155");
    expect(pinRowId("kakao", "101", "9001")).toBe("pin_kakao_101_9001");
    expect(providerListRowId("kakao", "101")).toBe("l_kakao_101");
    expect(providerItemRowId("kakao", "101", "9001")).toBe("i_kakao_101_9001");
    expect(ownItemRowId("list-a", "p_kakao_1")).toBe("li_list-a_p_kakao_1");
    expect(userListRowId("l_kakao_101")).toBe("ul_l_kakao_101");
    expect(userPlaceRowId("p_kakao_1")).toBe("up_p_kakao_1");
    expect(importedNoteRowId("p_kakao_1", "l_kakao_101")).toBe("kn_p%5Fkakao%5F1_l%5Fkakao%5F101");
  });

  it("makes UUIDv7 ids", () => {
    const id = newId();
    expect(id).toHaveLength(36);
    expect(id[14]).toBe("7");
  });
});

describe("push envelope tables", () => {
  const one = (table: string, op = "upsert") => ({
    mutations: [{ mutationId: "m", table, op, id: "x", row: {}, clientUpdatedAt: 1 }],
  });
  it("lets a delete on places through the envelope (the server refuses it)", () => {
    expect(pushEnvelopeSchema.safeParse(one("places", "delete")).success).toBe(true);
  });
  it("refuses server-owned tables", () => {
    for (const t of ["user_lists", "user_places", "place_sources", "place_locations"]) {
      expect(pushEnvelopeSchema.safeParse(one(t)).success, t).toBe(false);
    }
  });
});

describe("text and numbers Postgres can store", () => {
  const note = (body: string) => ({
    id: newId(),
    placeId: "p_kakao_1",
    visitedOn: null,
    body,
    origin: "user",
    originKey: null,
    editedByUser: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  it("rejects a NUL character", () => {
    expect(mutationRowSchemas.visit_notes.safeParse(note("a\u0000b")).success).toBe(false);
  });

  it("rejects a lone surrogate", () => {
    expect(mutationRowSchemas.visit_notes.safeParse(note("emoji \ud83d cut")).success).toBe(false);
  });

  it("accepts a whole emoji", () => {
    expect(mutationRowSchemas.visit_notes.safeParse(note("좋아요 😀")).success).toBe(true);
  });

  it("rejects a list position beyond a 32-bit integer", () => {
    const item = {
      id: "li_a_p_kakao_1",
      listId: "a",
      placeId: "p_kakao_1",
      position: 1_763_000_000_000,
      addedAt: now,
      kakaoFavoriteSeq: null,
      kakaoNote: null,
      kakaoColor: null,
      removedFromKakaoAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    expect(mutationRowSchemas.list_items.safeParse(item).success).toBe(false);
  });
});

describe("review fixes: ids and signatures", () => {
  it("builds unambiguous ids even when parts contain separators", () => {
    expect(providerItemRowId("kakao", "a_b", "c")).not.toBe(providerItemRowId("kakao", "a", "b_c"));
    expect(pinRowId("kakao", "a_b", "c")).not.toBe(pinRowId("kakao", "a", "b_c"));
    expect(placeRowId("kakao", "x_y")).not.toBe(`${placeRowId("kakao", "x")}_y`);
    expect(placeRowId("kakao", "27324155")).toBe("p_kakao_27324155");
  });

  it("requires UUIDs for own lists, notes and links", () => {
    const list = {
      id: "l_kakao_1",
      provider: null,
      externalId: null,
      name: "x",
      description: null,
      color: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    expect(mutationRowSchemas.lists.safeParse(list).success).toBe(false);
    expect(mutationRowSchemas.lists.safeParse({ ...list, id: newId() }).success).toBe(true);
    const link = {
      ...baseRow,
      id: "custom-id",
      placeId: "p_kakao_1",
      url: "https://example.com",
      title: null,
    };
    expect(mutationRowSchemas.links.safeParse(link).success).toBe(false);
    expect(mutationRowSchemas.links.safeParse({ ...link, id: newId() }).success).toBe(true);
  });

  it("describes a search result as one canonical string to sign", () => {
    const result = {
      provider: "kakao",
      externalId: "1",
      title: "카페",
      address: "제주",
      roadAddress: null,
      category: null,
      phone: null,
      lat: 33.4,
      lng: 126.3,
    };
    expect(searchSignaturePayload(result, 1000)).toBe(searchSignaturePayload({ ...result }, 1000));
    expect(searchSignaturePayload(result, 1000)).not.toBe(
      searchSignaturePayload({ ...result, lat: 33.5 }, 1000),
    );
    expect(searchSignaturePayload(result, 1000)).not.toBe(searchSignaturePayload(result, 1001));
  });
});

describe("pushed places carry their search signature", () => {
  it("keeps the signature and signing time when parsing a place", () => {
    const row = {
      id: "p_kakao_42",
      title: "t",
      address: null,
      roadAddress: null,
      addressSource: "search",
      category: null,
      phone: null,
      lat: 33.46,
      lng: 126.31,
      providerSnapshotAt: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      source: { provider: "kakao", externalId: "42", signature: "abc", signedAt: 5 },
    };
    expect(mutationRowSchemas.places.parse(row).source).toEqual({
      provider: "kakao",
      externalId: "42",
      signature: "abc",
      signedAt: 5,
    });
    expect(
      mutationRowSchemas.places.safeParse({
        ...row,
        source: { provider: "kakao", externalId: "42" },
      }).success,
    ).toBe(false);
  });
});
