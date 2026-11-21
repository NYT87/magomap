// Kakao Map points from the owner's account (docs/kakao-map-access.md, 2026-11-20): a favourite's
// WCONGNAMUL x/y, and the WGS84 position Kakao itself reports for it (the favourite's own lat/lon,
// or Kakao's place-detail endpoint). The converter must match each within 1e-5.
export const OWNER_FIXTURES: { x: number; y: number; lat: number; lng: number }[] = [
  // Southern Jeju: a negative y is a real point.
  { x: 471350, y: -32433, lat: 33.37661909, lng: 126.87684594 },
  { x: 608064, y: 1159067, lat: 37.67127631, lng: 127.48995646 },
];
