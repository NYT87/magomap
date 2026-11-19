import { describe, expect, it } from "vitest";
import {
  customPinRowId,
  importedNoteRowId,
  kakaoListRowId,
  kakaoMembershipRowId,
  kakaoPlaceRowId,
  newId,
  ownMembershipRowId,
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
    const row = { ...baseRow, id: "l1", placeId: "kp_1", url: "javascript:alert(1)", title: null };
    expect(mutationRowSchemas.links.safeParse(row).success).toBe(false);
  });

  it("accepts an https link", () => {
    const row = {
      ...baseRow,
      id: "l1",
      placeId: "kp_1",
      url: "https://example.com/a",
      title: null,
    };
    expect(mutationRowSchemas.links.safeParse(row).success).toBe(true);
  });

  it("rejects an impossible visit date", () => {
    const row = {
      ...baseRow,
      id: "n1",
      placeId: "kp_1",
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
      placeId: "kp_1",
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
      placeId: "kp_1",
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
  it("builds the deterministic ids", () => {
    expect(kakaoPlaceRowId("123")).toBe("kp_123");
    expect(customPinRowId("987")).toBe("kf_987");
    expect(kakaoListRowId(55)).toBe("kl_55");
    expect(kakaoMembershipRowId(55, "987")).toBe("ki_55_987");
    expect(ownMembershipRowId("list-a", "kp_123")).toBe("li_list-a_kp_123");
    expect(importedNoteRowId("kp_123", 55)).toBe("kn_kp_123_55");
  });

  it("makes UUIDv7 ids", () => {
    const id = newId();
    expect(id).toHaveLength(36);
    expect(id[14]).toBe("7");
  });
});

describe("text and numbers Postgres can store", () => {
  const note = (body: string) => ({
    id: "n1",
    placeId: "kp_1",
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
      id: "li_a_kp_1",
      listId: "a",
      placeId: "kp_1",
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
