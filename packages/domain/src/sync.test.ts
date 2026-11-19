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
import { mutationRowSchemas, pushEnvelopeSchema } from "./sync";

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
      id: "l1",
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
      id: "n1",
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
      id: "n1",
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
    expect(importedNoteRowId("p_kakao_1", "l_kakao_101")).toBe("kn_p_kakao_1_l_kakao_101");
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
    id: "n1",
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
