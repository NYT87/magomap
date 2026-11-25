import type { NearbyResult } from "@magomap/domain";
import { ApiError, apiFetch, NetworkError } from "../api/client";
import type { LatLng } from "./MapAdapter";

/** The Kakao places nearest a point on the map, nearest first (needs a connection). */
export async function fetchNearby(point: LatLng): Promise<NearbyResult[]> {
  const query = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
  const body = await apiFetch<{ results: NearbyResult[] }>(`/api/search/nearby?${query}`);
  return body.results;
}

export type NearbyFailure = "offline" | "rate_limited" | "unavailable";

/** Why a nearby lookup failed, in the words the menu has a message for. */
export function nearbyFailure(error: unknown): NearbyFailure {
  if (error instanceof NetworkError || !navigator.onLine) return "offline";
  if (error instanceof ApiError && error.code === "rate_limited") return "rate_limited";
  return "unavailable";
}
