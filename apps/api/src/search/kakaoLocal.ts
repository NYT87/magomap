import type { SearchResult } from "@magomap/domain";
import { KAKAO } from "@magomap/domain/providers/kakao";

/** A Kakao Local document, from keyword or category search: https://developers.kakao.com/docs/latest/en/local/dev-guide */
export interface KakaoDocument {
  id: string;
  place_name: string;
  address_name?: string;
  road_address_name?: string;
  category_name?: string;
  phone?: string;
  x: string;
  y: string;
  /** Metres from the asked point, as a string; empty when no point was given. */
  distance?: string;
}

const orNull = (value: string | undefined) => (value ? value : null);

/** The unsigned search result for a Kakao document, or null when its id or coordinates are unusable. */
export function toSearchResult(
  d: KakaoDocument,
): Omit<SearchResult, "signedAt" | "signature"> | null {
  const result = {
    provider: KAKAO,
    externalId: d.id,
    title: d.place_name,
    address: orNull(d.address_name),
    roadAddress: orNull(d.road_address_name),
    category: orNull(d.category_name),
    phone: orNull(d.phone),
    lat: Number(d.y),
    lng: Number(d.x),
  };
  if (!result.externalId || !Number.isFinite(result.lat) || !Number.isFinite(result.lng))
    return null;
  return result;
}
