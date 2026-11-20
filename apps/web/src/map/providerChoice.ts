import type { LatLng, MapAdapter } from "./MapAdapter";

/** The map setting in Account. */
export type MapChoice = "auto" | "kakao" | "osm";

export const MAP_CHOICES: readonly MapChoice[] = ["auto", "kakao", "osm"];

interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Korea, where Kakao Map has detail. Automatic switches to Kakao only inside this box. */
export const KOREA_INNER: Box = { south: 33.0, north: 38.7, west: 124.5, east: 131.0 };
/** The inner box plus a margin: Automatic leaves Kakao only outside it, so it never flickers. */
export const KOREA_OUTER: Box = { south: 32.0, north: 39.5, west: 123.5, east: 132.0 };

const inside = (box: Box, p: LatLng) =>
  p.lat >= box.south && p.lat <= box.north && p.lng >= box.west && p.lng <= box.east;

/** Which map to show for the setting, the map's centre and the map in use (null before any). */
export function providerFor(
  choice: MapChoice,
  center: LatLng,
  current: MapAdapter["provider"] | null,
  kakaoAvailable: boolean,
): MapAdapter["provider"] {
  if (!kakaoAvailable || choice === "osm") return "leaflet";
  if (choice === "kakao") return "kakao";
  const box = current === "kakao" ? KOREA_OUTER : KOREA_INNER;
  return inside(box, center) ? "kakao" : "leaflet";
}
