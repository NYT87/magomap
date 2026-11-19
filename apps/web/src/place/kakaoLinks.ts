/** Kakao Map links for a Kakao place id: the app first, the web page as the fallback. */
export function kakaoLinks(id: string): { app: string; web: string } {
  return {
    app: `kakaomap://place?id=${encodeURIComponent(id)}`,
    web: `https://place.map.kakao.com/${encodeURIComponent(id)}`,
  };
}

/** On phones: try the app, and open the web page if we're still here after 1.5 s. */
export function openKakaoPlace(id: string) {
  const { app, web } = kakaoLinks(id);
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
