import { placeRowId } from "@magomap/domain/ids";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { currentDb } from "../data/db";
import { savePlaceFromSearch } from "../data/writes";
import { SEARCH_INPUT_ID } from "../layout/AppLayout";
import type { LatLng, MapMarker } from "../map/MapAdapter";
import { useMapStage } from "../map/MapStage";
import { openSearchHit, type SearchHit, useSearch } from "./useSearch";

const hitKey = (h: SearchHit) => (h.kind === "saved" ? h.placeId : `search:${h.result.externalId}`);

/** One search box: Kakao results online (with Save), the user's own places offline. */
export function SearchBar() {
  const { t } = useTranslation();
  const stage = useMapStage();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const resultsId = useId();
  // Search near what's on screen, read as the query is typed (not on every map move).
  const [center, setCenter] = useState<LatLng | null>(null);
  const search = useSearch(q, center);

  const savedPlaces = useLiveQuery(async () => {
    const ids = search.results.flatMap((h) => (h.kind === "saved" ? [h.placeId] : []));
    const rows = await currentDb().places.bulkGet(ids);
    return new Map(rows.flatMap((p) => (p ? [[p.id, p] as const] : [])));
  }, [search.results]);

  const { setSearchMarkers, setOnSearchSelect } = stage;
  useEffect(() => {
    const markers: MapMarker[] = search.results.flatMap((h) =>
      h.kind === "kakao" && !h.savedPlaceId
        ? [
            {
              id: `search:${h.result.externalId}`,
              position: { lat: h.result.lat, lng: h.result.lng },
              color: "var(--color-text)",
              label: h.result.title,
              kind: "search" as const,
            },
          ]
        : [],
    );
    setSearchMarkers(markers);
  }, [search.results, setSearchMarkers]);
  useEffect(() => {
    setOnSearchSelect((id) => {
      setSelected(id);
      document.getElementById(`hit-${id}`)?.scrollIntoView({ block: "nearest" });
    });
    return () => {
      setOnSearchSelect(null);
      setSearchMarkers([]);
    };
  }, [setOnSearchSelect, setSearchMarkers]);

  const open = async (hit: SearchHit) => {
    const id = await openSearchHit(hit);
    if (id) {
      setQ("");
      navigate(`/places/${encodeURIComponent(id)}`);
    } else if (hit.kind === "kakao") {
      setSelected(hitKey(hit));
      stage.setFocus({ lat: hit.result.lat, lng: hit.result.lng }, { close: true });
    }
  };

  const save = async (hit: Extract<SearchHit, { kind: "kakao" }>) => {
    setSaveFailed(false);
    setSaving(hit.result.externalId);
    try {
      const id = await savePlaceFromSearch(hit.result);
      setQ("");
      navigate(`/places/${encodeURIComponent(id)}`);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(null);
    }
  };

  const showResults = q.trim().length > 0;
  return (
    <search className="mm-search">
      <div className="mm-search__box">
        <Search aria-hidden size={20} strokeWidth={1.75} className="mm-search__icon" />
        <label htmlFor={SEARCH_INPUT_ID} className="mm-visually-hidden">
          {t("search.label")}
        </label>
        <input
          id={SEARCH_INPUT_ID}
          className="mm-search__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t("search.placeholder")}
          value={q}
          aria-controls={showResults ? resultsId : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setCenter(stage.map.current?.getCenter() ?? null);
          }}
        />
        {q && (
          <button type="button" className="mm-icon-button" onClick={() => setQ("")}>
            <X aria-hidden size={18} strokeWidth={1.75} />
            <span className="mm-visually-hidden">{t("search.clear")}</span>
          </button>
        )}
      </div>
      {/* Always mounted, so screen readers announce the count and why results are limited. */}
      <p className="mm-visually-hidden" aria-live="polite">
        {!showResults || search.loading
          ? ""
          : [
              t("search.results", { count: search.results.length }),
              search.mode === "local" ? t("search.offline") : "",
              search.error === "rate_limited" ? t("search.rateLimited") : "",
              search.error === "search_unavailable" ? t("search.unavailable") : "",
            ]
              .filter(Boolean)
              .join(" ")}
      </p>
      {showResults && (
        <div className="mm-search__results" id={resultsId}>
          {search.mode === "local" && <p className="mm-note">{t("search.offline")}</p>}
          {search.error === "rate_limited" && <p className="mm-note">{t("search.rateLimited")}</p>}
          {search.error === "search_unavailable" && (
            <p className="mm-note">{t("search.unavailable")}</p>
          )}
          {saveFailed && (
            <p className="mm-error" role="alert">
              {t("search.saveFailed")}
            </p>
          )}
          {!search.loading &&
            search.results.length === 0 &&
            !search.error &&
            q.trim().length > 1 && (
              <p className="mm-muted">{t("search.noResults", { q: q.trim() })}</p>
            )}
          <ul className="mm-search__list">
            {search.results.map((hit) => {
              const key = hitKey(hit);
              if (hit.kind === "saved") {
                const p = savedPlaces?.get(hit.placeId);
                if (!p) return null;
                return (
                  <li key={key} id={`hit-${key}`} className="mm-hit">
                    <button type="button" className="mm-hit__main" onClick={() => void open(hit)}>
                      <span className="mm-hit__title">{p.title}</span>
                      <span className="mm-muted">{p.roadAddress ?? p.address ?? ""}</span>
                    </button>
                    <span className="mm-badge">{t("search.saved")}</span>
                  </li>
                );
              }
              const r = hit.result;
              const id = placeRowId(r.provider, r.externalId);
              return (
                <li
                  key={key}
                  id={`hit-${key}`}
                  className="mm-hit"
                  data-selected={selected === key || undefined}
                >
                  <button type="button" className="mm-hit__main" onClick={() => void open(hit)}>
                    <span className="mm-hit__title">{r.title}</span>
                    <span className="mm-muted">
                      {[r.category, r.roadAddress ?? r.address].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  {hit.savedPlaceId ? (
                    <span className="mm-badge">{t("search.saved")}</span>
                  ) : (
                    <button
                      type="button"
                      className="mm-button mm-button--secondary mm-button--small"
                      disabled={saving === r.externalId}
                      aria-describedby={`hit-${key}`}
                      onClick={() => void save(hit)}
                      data-place={id}
                    >
                      {saving === r.externalId ? t("search.saving") : t("search.save")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </search>
  );
}
