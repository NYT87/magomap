import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
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
    expect(await res.json()).toEqual({
      isEnd: true,
      results: [
        {
          kakaoPlaceId: "27324155",
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
