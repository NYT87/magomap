import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { verifySearchSignature } from "../src/search/signing";
import { call, devLogin } from "./helpers";
import { network } from "./msw";

const KAKAO = "https://dapi.kakao.com/v2/local/search/keyword.json";
// Shape from https://developers.kakao.com/docs/latest/en/local/dev-guide#search-by-keyword
const kakaoResponse = {
  meta: { is_end: true, pageable_count: 1, total_count: 1 },
  documents: [
    {
      id: "27324155",
      place_name: "바다정원 카페",
      category_name: "음식점 > 카페",
      phone: "064-000-0000",
      address_name: "제주특별자치도 제주시 애월읍 고내리 1",
      road_address_name: "제주특별자치도 제주시 애월읍 애월해안로 1",
      x: "126.3095",
      y: "33.4627",
      place_url: "http://place.map.kakao.com/27324155",
      distance: "",
    },
  ],
};

describe("place search", () => {
  it("maps Kakao results and biases them to the map centre", async () => {
    const cookie = await devLogin("111");
    let asked: URL | undefined;
    let auth = "";
    network.use(
      http.get(KAKAO, ({ request }) => {
        asked = new URL(request.url);
        auth = request.headers.get("authorization") ?? "";
        return HttpResponse.json(kakaoResponse);
      }),
    );
    const res = await call("/api/search/places?q=%EC%B9%B4%ED%8E%98&lat=33.46&lng=126.31", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { signature: string; signedAt: number }[] };
    expect(typeof body.results[0]?.signature).toBe("string");
    expect(verifySearchSignature("s".repeat(48), body.results[0] as never)).toBe(true);
    expect(
      verifySearchSignature("s".repeat(48), { ...(body.results[0] as object), lat: 0 } as never),
    ).toBe(false);
    expect(body).toMatchObject({
      isEnd: true,
      results: [
        {
          provider: "kakao",
          externalId: "27324155",
          title: "바다정원 카페",
          address: "제주특별자치도 제주시 애월읍 고내리 1",
          roadAddress: "제주특별자치도 제주시 애월읍 애월해안로 1",
          category: "음식점 > 카페",
          phone: "064-000-0000",
          lat: 33.4627,
          lng: 126.3095,
        },
      ],
    });
    expect(auth).toBe("KakaoAK test-rest-key");
    expect(asked?.searchParams.get("query")).toBe("카페");
    expect(asked?.searchParams.get("x")).toBe("126.31");
    expect(asked?.searchParams.get("y")).toBe("33.46");
    expect(asked?.searchParams.get("radius")).toBe("20000");
    expect(asked?.searchParams.get("sort")).toBe("accuracy");
  });

  it("rejects an empty or too long query", async () => {
    const cookie = await devLogin("111");
    expect((await call("/api/search/places?q=", { headers: { cookie } })).status).toBe(400);
    expect(
      (await call(`/api/search/places?q=${"a".repeat(101)}`, { headers: { cookie } })).status,
    ).toBe(400);
  });

  it("answers 429 when the user is over the limit", async () => {
    const cookie = await devLogin("111");
    const limiter = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await call("/api/search/places?q=cafe", { headers: { cookie } }, {
      SEARCH_LIMITER: limiter,
    } as never);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("answers 502 when Kakao fails, without leaking the key", async () => {
    const cookie = await devLogin("111");
    for (const status of [401, 503]) {
      network.use(
        http.get(KAKAO, () => HttpResponse.json({ msg: "test-rest-key is bad" }, { status })),
      );
      const res = await call("/api/search/places?q=cafe", { headers: { cookie } });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toBe(JSON.stringify({ error: "search_unavailable" }));
      expect(text).not.toContain("test-rest-key");
    }
  });

  it("requires a session", async () => {
    expect((await call("/api/search/places?q=cafe")).status).toBe(401);
  });
});

const KAKAO_CATEGORY = "https://dapi.kakao.com/v2/local/search/category.json";
const GROUPS = ["FD6", "CE7", "MT1", "CS2", "AT4", "AD5"];

// Shape from https://developers.kakao.com/docs/latest/en/local/dev-guide#search-by-category
function categoryDoc(id: string, distance: string) {
  return {
    id,
    place_name: `place ${id}`,
    category_name: "음식점 > 카페",
    category_group_code: "CE7",
    phone: "",
    address_name: `address ${id}`,
    road_address_name: `road ${id}`,
    x: "126.3095",
    y: "33.4627",
    place_url: `http://place.map.kakao.com/${id}`,
    distance,
  };
}

function categoryAnswer(documents: ReturnType<typeof categoryDoc>[]) {
  return {
    meta: { is_end: true, pageable_count: documents.length, total_count: documents.length },
    documents,
  };
}

interface NearbyBody {
  results: { result: { externalId: string; title: string }; distanceM: number }[];
}

describe("nearby places", () => {
  it("returns the nearest places first, merged across groups, de-duplicated by id, capped at 8, signed", async () => {
    const cookie = await devLogin("111");
    const byGroup: Record<string, ReturnType<typeof categoryDoc>[]> = {
      FD6: [categoryDoc("1", "12"), categoryDoc("2", "30"), categoryDoc("3", "44")],
      CE7: [categoryDoc("1", "12"), categoryDoc("4", "5"), categoryDoc("5", "48")],
      MT1: [categoryDoc("6", "20"), categoryDoc("7", "25")],
      CS2: [categoryDoc("8", "33"), categoryDoc("9", "40")],
      AT4: [categoryDoc("10", "49"), categoryDoc("2", "30")],
      AD5: [categoryDoc("11", "")],
    };
    network.use(
      http.get(KAKAO_CATEGORY, ({ request }) => {
        const group = new URL(request.url).searchParams.get("category_group_code") ?? "";
        return HttpResponse.json(categoryAnswer(byGroup[group] ?? []));
      }),
    );
    const res = await call("/api/search/nearby?lat=33.4627&lng=126.3095", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NearbyBody;
    expect(body.results.map((r) => r.result.externalId)).toEqual([
      "4",
      "1",
      "6",
      "7",
      "2",
      "8",
      "9",
      "3",
    ]);
    expect(body.results.map((r) => r.distanceM)).toEqual([5, 12, 20, 25, 30, 33, 40, 44]);
    for (const r of body.results) {
      expect(verifySearchSignature("s".repeat(48), r.result as never)).toBe(true);
    }
    expect(body.results[0]?.result).toMatchObject({
      provider: "kakao",
      title: "place 4",
      address: "address 4",
      roadAddress: "road 4",
      category: "음식점 > 카페",
      phone: null,
      lat: 33.4627,
      lng: 126.3095,
    });
  });

  it("puts a place without a distance last", async () => {
    const cookie = await devLogin("111");
    network.use(
      http.get(KAKAO_CATEGORY, ({ request }) => {
        const group = new URL(request.url).searchParams.get("category_group_code");
        if (group === "FD6") return HttpResponse.json(categoryAnswer([categoryDoc("1", "")]));
        if (group === "CE7") return HttpResponse.json(categoryAnswer([categoryDoc("2", "40")]));
        return HttpResponse.json(categoryAnswer([]));
      }),
    );
    const res = await call("/api/search/nearby?lat=33.4627&lng=126.3095", { headers: { cookie } });
    const body = (await res.json()) as NearbyBody;
    expect(body.results.map((r) => r.result.externalId)).toEqual(["2", "1"]);
    // It stands on the pressed point, so its worked-out distance is 0.
    expect(body.results.map((r) => r.distanceM)).toEqual([40, 0]);
  });

  it("asks Kakao once per group, around the point, within 50 m, nearest first", async () => {
    const cookie = await devLogin("111");
    const asked: URL[] = [];
    const auths: string[] = [];
    network.use(
      http.get(KAKAO_CATEGORY, ({ request }) => {
        asked.push(new URL(request.url));
        auths.push(request.headers.get("authorization") ?? "");
        return HttpResponse.json(categoryAnswer([]));
      }),
    );
    const res = await call("/api/search/nearby?lat=33.46&lng=126.31", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(asked).toHaveLength(6);
    expect(asked.map((u) => u.searchParams.get("category_group_code")).sort()).toEqual(
      [...GROUPS].sort(),
    );
    for (const u of asked) {
      expect(u.searchParams.get("x")).toBe("126.31");
      expect(u.searchParams.get("y")).toBe("33.46");
      expect(u.searchParams.get("radius")).toBe("50");
      expect(u.searchParams.get("sort")).toBe("distance");
    }
    expect(auths.every((a) => a === "KakaoAK test-rest-key")).toBe(true);
  });

  it("refuses a missing, non-numeric or out-of-range point", async () => {
    const cookie = await devLogin("111");
    for (const query of [
      "",
      "?lat=33",
      "?lat=abc&lng=126",
      "?lat=91&lng=0",
      "?lat=0&lng=181",
      "?lat=-91&lng=0",
      "?lat=0&lng=-181",
      "?lat=Infinity&lng=0",
    ]) {
      const res = await call(`/api/search/nearby${query}`, { headers: { cookie } });
      expect(res.status, query).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid" });
    }
  });

  it("skips a group that fails and answers 502 only when all fail", async () => {
    const cookie = await devLogin("111");
    network.use(
      http.get(KAKAO_CATEGORY, ({ request }) => {
        const group = new URL(request.url).searchParams.get("category_group_code");
        if (group === "CE7") return HttpResponse.json(categoryAnswer([categoryDoc("4", "5")]));
        if (group === "FD6") return HttpResponse.error();
        return HttpResponse.json({ msg: "test-rest-key is bad" }, { status: 503 });
      }),
    );
    const partial = await call("/api/search/nearby?lat=33.46&lng=126.31", { headers: { cookie } });
    expect(partial.status).toBe(200);
    expect(((await partial.json()) as NearbyBody).results.map((r) => r.result.externalId)).toEqual([
      "4",
    ]);

    network.use(
      http.get(KAKAO_CATEGORY, () =>
        HttpResponse.json({ msg: "test-rest-key is bad" }, { status: 503 }),
      ),
    );
    const res = await call("/api/search/nearby?lat=33.46&lng=126.31", { headers: { cookie } });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "search_unavailable" }));
    expect(text).not.toContain("test-rest-key");
  });

  it("answers 429 when the limiter refuses, counting one press once", async () => {
    const cookie = await devLogin("111");
    const keys: string[] = [];
    const refusing = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as unknown as RateLimit;
    const res = await call("/api/search/nearby?lat=33.46&lng=126.31", { headers: { cookie } }, {
      SEARCH_LIMITER: refusing,
    } as never);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(keys).toHaveLength(1);

    let counted = 0;
    const allowing = {
      limit: async () => {
        counted += 1;
        return { success: true };
      },
    } as unknown as RateLimit;
    network.use(http.get(KAKAO_CATEGORY, () => HttpResponse.json(categoryAnswer([]))));
    const ok = await call("/api/search/nearby?lat=33.46&lng=126.31", { headers: { cookie } }, {
      SEARCH_LIMITER: allowing,
    } as never);
    expect(ok.status).toBe(200);
    expect(counted).toBe(1);
  });

  it("requires a session", async () => {
    expect((await call("/api/search/nearby?lat=33.46&lng=126.31")).status).toBe(401);
  });
});
