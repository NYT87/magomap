export type AddressSource = "kakao_import" | "search";

export type LocationFields = {
  lat: number | null;
  lng: number | null;
  address: string | null;
  roadAddress: string | null;
  addressSource: AddressSource | null;
};

type LatLng = { lat: number; lng: number };

/** A place counts as moved only beyond this distance, so Kakao's coordinate jitter is ignored. */
export const MOVE_THRESHOLD_METERS = 30;

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Great-circle distance (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coords(value: Partial<LocationFields>): LatLng | null {
  const { lat, lng } = value;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

/**
 * Whether `incoming` describes a different location from `current`.
 * With coordinates on both sides only distance counts; otherwise the address counts,
 * and only when both addresses come from the same source. Missing values never count.
 */
export function isLocationMove(
  current: LocationFields,
  incoming: Partial<LocationFields>,
): boolean {
  const from = coords(current);
  const to = coords(incoming);
  if (from && to) return distanceMeters(from, to) > MOVE_THRESHOLD_METERS;
  if (to) return false; // first coordinates: a silent fill
  const address = incoming.address;
  if (address == null || current.address == null) return false;
  if (incoming.addressSource == null || incoming.addressSource !== current.addressSource)
    return false;
  return address !== current.address;
}

/** Applies incoming location fields; null and undefined never overwrite a value. */
export function mergeLocation(
  current: LocationFields,
  incoming: Partial<LocationFields>,
): LocationFields {
  const pick = <K extends keyof LocationFields>(key: K): LocationFields[K] =>
    incoming[key] ?? current[key];
  return {
    lat: pick("lat"),
    lng: pick("lng"),
    address: pick("address"),
    roadAddress: pick("roadAddress"),
    addressSource: pick("addressSource"),
  };
}
