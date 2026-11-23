// Kakao Map's WCONGNAMUL coordinates to WGS84 latitude/longitude.
// WCONGNAMUL is EPSG:5181 (Korea 2000 / Central Belt) scaled by 2.5; confirmed against Kakao's own
// positions in docs/kakao-map-access.md. Same rule as kakao-list's packages/domain/src/coordinates.ts.
// proj4: https://github.com/proj4js/proj4js#using
import proj4 from "proj4";

const EPSG_5181 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";
const toWgs84 = proj4(EPSG_5181, "WGS84");

export interface LatLng {
  lat: number;
  lng: number;
}

/** A usable input: a finite, non-zero number. Negative values are real (southern Jeju's `y`). */
const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v !== 0;

/** Inside the box magomap accepts for Kakao places: 32–40°N, 123–133°E. */
const inKorea = (lat: number, lng: number) => lat >= 32 && lat <= 40 && lng >= 123 && lng <= 133;

/** Latitude/longitude for a WCONGNAMUL point, or undefined when it isn't a usable point in Korea. */
export function wcongnamulToLatLng(x: unknown, y: unknown): LatLng | undefined {
  if (!usable(x) || !usable(y)) return undefined;
  const [lng, lat] = toWgs84.forward([x / 2.5, y / 2.5]) as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) return undefined;
  return { lat, lng };
}

/**
 * A point's WCONGNAMUL x/y as `/favorite/add` takes them (whole numbers), or undefined when it
 * isn't a finite point in Korea. The reverse of `wcongnamulToLatLng`.
 */
export function latLngToWcongnamul(
  lat: unknown,
  lng: unknown,
): { x: number; y: number } | undefined {
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) return undefined;
  const [x, y] = toWgs84.inverse([lng, lat]) as [number, number];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x * 2.5), y: Math.round(y * 2.5) };
}

/** A favourite's position: Kakao's own `lat`/`lon` when usable, else its converted `x`/`y`. */
export function kakaoFavoritePoint(favorite: {
  lat?: unknown;
  lon?: unknown;
  x?: unknown;
  y?: unknown;
}): LatLng | undefined {
  const { lat, lon } = favorite;
  if (usable(lat) && usable(lon) && inKorea(lat, lon)) return { lat, lng: lon };
  return wcongnamulToLatLng(favorite.x, favorite.y);
}
