import type { NearbyResult } from "@magomap/domain";
import { type KakaoDocument, toSearchResult } from "./kakaoLocal";
import { signSearchResult } from "./signing";

/** How far around the pressed point to look. */
export const NEARBY_RADIUS_M = 50;
/** How many places one press shows at most. */
export const NEARBY_MAX_RESULTS = 8;
/**
 * Kakao Local category groups asked on each press, one call each, in parallel (six: the ceiling
 * per press). Restaurants, cafés, large marts, convenience stores, attractions, lodging.
 */
export const NEARBY_CATEGORY_GROUPS = ["FD6", "CE7", "MT1", "CS2", "AT4", "AD5"] as const;

export type NearbyPoint = { lat: number; lng: number };

/** The point in a nearby query, or null when either coordinate is missing, not finite or out of range. */
export function parseNearbyPoint(
  lat: string | undefined,
  lng: string | undefined,
): NearbyPoint | null {
  if (!lat?.trim() || !lng?.trim()) return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
  return point;
}

type Unsigned = NonNullable<ReturnType<typeof toSearchResult>>;

/** Great-circle distance in metres. */
function metresBetween(a: NearbyPoint, b: NearbyPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function askGroup(
  apiKey: string,
  point: NearbyPoint,
  group: string,
): Promise<KakaoDocument[]> {
  // Kakao Local category search: https://developers.kakao.com/docs/latest/en/local/dev-guide#search-by-category
  const url = new URL("https://dapi.kakao.com/v2/local/search/category.json");
  url.searchParams.set("category_group_code", group);
  url.searchParams.set("x", String(point.lng));
  url.searchParams.set("y", String(point.lat));
  url.searchParams.set("radius", String(NEARBY_RADIUS_M));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", String(NEARBY_MAX_RESULTS));
  const res = await fetch(url, { headers: { authorization: `KakaoAK ${apiKey}` } });
  if (!res.ok) throw new Error(`kakao category search ${res.status}`);
  const body = (await res.json()) as { documents?: KakaoDocument[] };
  return body.documents ?? [];
}

/**
 * The Kakao places nearest the point, nearest first, merged across the category groups and
 * signed like search results. Null when every group's call failed.
 */
export async function findNearby(
  apiKey: string,
  secret: string,
  point: NearbyPoint,
  now: number,
): Promise<NearbyResult[] | null> {
  const answers = await Promise.allSettled(
    NEARBY_CATEGORY_GROUPS.map((group) => askGroup(apiKey, point, group)),
  );
  if (answers.every((a) => a.status === "rejected")) return null;

  type Candidate = { result: Unsigned; distanceM: number; sortKey: number };
  const nearest = new Map<string, Candidate>();
  for (const answer of answers) {
    if (answer.status !== "fulfilled") continue;
    for (const doc of answer.value) {
      const result = toSearchResult(doc);
      if (!result) continue;
      const given = doc.distance?.trim() ? Math.round(Number(doc.distance)) : Number.NaN;
      // Kakao gives a distance whenever a point is asked; without one, the place sorts last
      // and shows the distance worked out from its coordinates.
      const candidate = Number.isFinite(given)
        ? { result, distanceM: given, sortKey: given }
        : {
            result,
            distanceM: Math.round(metresBetween(point, result)),
            sortKey: Number.POSITIVE_INFINITY,
          };
      const known = nearest.get(result.externalId);
      if (!known || candidate.sortKey < known.sortKey) nearest.set(result.externalId, candidate);
    }
  }
  return [...nearest.values()]
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, NEARBY_MAX_RESULTS)
    .map(({ result, distanceM }) => ({
      result: { ...result, ...signSearchResult(secret, result, now) },
      distanceM,
    }));
}
