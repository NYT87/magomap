import type { SearchResult } from "@magomap/domain";
import { placeRowId } from "@magomap/domain/ids";
import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch, NetworkError } from "../api/client";
import { currentDb } from "../data/db";
import { searchLocal } from "../data/queries";
import { refreshPlaceFromSearch } from "../data/writes";
import type { LatLng } from "../map/MapAdapter";

export type SearchHit =
  | { kind: "saved"; placeId: string }
  | { kind: "kakao"; result: SearchResult; savedPlaceId?: string };

export interface SearchState {
  mode: "kakao" | "local";
  results: SearchHit[];
  loading: boolean;
  error?: "search_unavailable" | "rate_limited";
}

const DEBOUNCE_MS = 300;

async function local(q: string): Promise<SearchHit[]> {
  return (await searchLocal(currentDb(), q)).map((placeId) => ({ kind: "saved", placeId }));
}

/** Places this account already has, so a search result can say "saved". */
async function known(): Promise<Set<string>> {
  const db = currentDb();
  const [mine, listed] = await Promise.all([db.user_places.toArray(), db.list_items.toArray()]);
  return new Set([
    ...mine.filter((m) => m.deletedAt == null).map((m) => m.placeId),
    ...listed.filter((i) => i.deletedAt == null).map((i) => i.placeId),
  ]);
}

/** Kakao search online (debounced, 2+ characters); saved-place search offline. */
export function useSearch(q: string, center: LatLng | null): SearchState {
  const [state, setState] = useState<SearchState>({ mode: "kakao", results: [], loading: false });
  const seq = useRef(0);
  const lat = center?.lat;
  const lng = center?.lng;

  useEffect(() => {
    const query = q.trim();
    const mine = ++seq.current;
    const set = (next: (prev: SearchState) => SearchState) => {
      if (mine === seq.current) setState(next);
    };
    if (query.length === 0) {
      set((p) => ({ ...p, results: [], loading: false, error: undefined }));
      return;
    }
    const goLocal = async () => {
      const results = await local(query);
      set(() => ({ mode: "local", results, loading: false }));
    };
    if (!navigator.onLine) {
      void goLocal();
      return;
    }
    if (query.length < 2) {
      set((p) => ({ ...p, results: [], loading: false, error: undefined }));
      return;
    }
    set((p) => ({ ...p, loading: true }));
    const timer = setTimeout(async () => {
      const near = lat != null && lng != null ? `&lat=${lat}&lng=${lng}` : "";
      try {
        const res = await apiFetch<{ results: SearchResult[] }>(
          `/api/search/places?q=${encodeURIComponent(query)}${near}`,
        );
        const have = await known();
        const kakao: SearchHit[] = res.results.map((result) => {
          const id = placeRowId(result.provider, result.externalId);
          return have.has(id)
            ? { kind: "kakao", result, savedPlaceId: id }
            : { kind: "kakao", result };
        });
        // Her own places that match by name, address or what she wrote come first.
        const inKakao = new Set(
          kakao.flatMap((h) => (h.kind === "kakao" && h.savedPlaceId ? [h.savedPlaceId] : [])),
        );
        const mine = (await local(query)).filter(
          (h) => h.kind === "saved" && !inKakao.has(h.placeId),
        );
        const results = [...mine, ...kakao];
        set(() => ({ mode: "kakao", results, loading: false }));
      } catch (error) {
        if (error instanceof NetworkError) return void goLocal();
        const code =
          error instanceof ApiError && error.code === "rate_limited"
            ? "rate_limited"
            : "search_unavailable";
        // Keep what was shown; say why nothing new came.
        set((p) => ({ ...p, loading: false, error: code }));
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, lat, lng]);

  return state;
}

/** Opening a result: a saved place gets the newer location, then opens. Returns the place id. */
export async function openSearchHit(hit: SearchHit): Promise<string | null> {
  if (hit.kind === "saved") return hit.placeId;
  if (!hit.savedPlaceId) return null;
  await refreshPlaceFromSearch(hit.result);
  return hit.savedPlaceId;
}
