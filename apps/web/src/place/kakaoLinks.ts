export interface KakaoLinks {
  app: string;
  web: string;
}

/**
 * Kakao Map links: the app first, the web page as the fallback.
 * A numeric id is a Kakao place (its own page). Other ids, such as ADDRESS favourites' `N…`/`J…`
 * keys, aren't place pages: those open the map at the point, or have no link without one.
 * https://apis.map.kakao.com/web/guide/#bigmapurl
 */
export function kakaoLinks(
  id: string,
  point?: { title: string; lat: number; lng: number },
): KakaoLinks | null {
  if (/^\d+$/.test(id)) {
    return {
      app: `kakaomap://place?placeId=${encodeURIComponent(id)}`,
      web: `https://place.map.kakao.com/${encodeURIComponent(id)}`,
    };
  }
  if (!point) return null;
  const at = `${point.lat},${point.lng}`;
  // Commas separate the link's fields, so the name can't carry any.
  const name = encodeURIComponent(point.title.replace(/,/g, ""));
  return {
    app: `kakaomap://look?p=${at}`,
    web: `https://map.kakao.com/link/map/${name},${at}`,
  };
}

/** On phones: try the app, and open the web page if we're still here after 1.5 s. */
export function openKakaoPlace({ app, web }: KakaoLinks) {
  const timer = setTimeout(() => {
    if (document.visibilityState === "visible") window.location.href = web;
  }, 1_500);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") clearTimeout(timer);
    },
    { once: true },
  );
  window.location.href = app;
}
