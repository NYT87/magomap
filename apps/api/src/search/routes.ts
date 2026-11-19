import type { SearchResult } from "@magomap/domain";
import { KAKAO } from "@magomap/domain/providers/kakao";
import { Hono } from "hono";
import { requireUser } from "../auth/session";
import type { AppEnv } from "../env";

export const searchRoutes = new Hono<AppEnv>();
searchRoutes.use("/search/*", requireUser);

interface KakaoDocument {
  id: string;
  place_name: string;
  address_name?: string;
  road_address_name?: string;
  category_name?: string;
  phone?: string;
  x: string;
  y: string;
}

const orNull = (value: string | undefined) => (value ? value : null);

/** Kakao Local keyword search: https://developers.kakao.com/docs/latest/en/local/dev-guide#search-by-keyword */
searchRoutes.get("/search/places", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 1 || q.length > 100) return c.json({ error: "invalid" }, 400);
  const page = Math.min(Math.max(Number(c.req.query("page") ?? 1) || 1, 1), 45);

  if (c.env.SEARCH_LIMITER) {
    const { success } = await c.env.SEARCH_LIMITER.limit({ key: c.var.userId });
    if (!success) return c.json({ error: "rate_limited" }, 429);
  }

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", q);
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "accuracy");
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (c.req.query("lat") && c.req.query("lng") && Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set("x", String(lng));
    url.searchParams.set("y", String(lat));
    url.searchParams.set("radius", "20000");
  }

  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `KakaoAK ${c.env.KAKAO_REST_API_KEY}` } });
  } catch {
    return c.json({ error: "search_unavailable" }, 502);
  }
  if (!res.ok) return c.json({ error: "search_unavailable" }, 502);
  const body = (await res.json()) as { documents?: KakaoDocument[]; meta?: { is_end?: boolean } };
  const results: SearchResult[] = (body.documents ?? [])
    .map((d) => ({
      provider: KAKAO,
      externalId: d.id,
      title: d.place_name,
      address: orNull(d.address_name),
      roadAddress: orNull(d.road_address_name),
      category: orNull(d.category_name),
      phone: orNull(d.phone),
      lat: Number(d.y),
      lng: Number(d.x),
    }))
    .filter((r) => r.externalId && Number.isFinite(r.lat) && Number.isFinite(r.lng));
  return c.json({ results, isEnd: body.meta?.is_end ?? true });
});
