import type { PublicConfig } from "@magomap/domain";
import { createKakaoAdapter } from "./kakaoAdapter";
import { createLeafletAdapter } from "./leafletAdapter";
import type { MapAdapter } from "./MapAdapter";

const SDK = "https://dapi.kakao.com/v2/maps/sdk.js";

/** Kakao Maps when a key is set and the SDK loads in time; Leaflet + OpenStreetMap otherwise. */
export function loadMapAdapter(
  config: PublicConfig,
  opts: { timeoutMs?: number } = {},
): Promise<MapAdapter> {
  const key = config.kakaoJavascriptKey;
  if (!key) return Promise.resolve(createLeafletAdapter());
  return new Promise<MapAdapter>((resolve) => {
    let done = false;
    const finish = (adapter: () => MapAdapter) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        resolve(adapter());
      } catch {
        resolve(createLeafletAdapter());
      }
    };
    const timer = setTimeout(() => finish(createLeafletAdapter), opts.timeoutMs ?? 8_000);
    const script = document.createElement("script");
    script.src = `${SDK}?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`;
    script.async = true;
    script.addEventListener("error", () => finish(createLeafletAdapter));
    script.addEventListener("load", () => {
      const kakao = (window as unknown as { kakao?: { maps?: { load(cb: () => void): void } } })
        .kakao;
      if (!kakao?.maps) return finish(createLeafletAdapter);
      kakao.maps.load(() => finish(createKakaoAdapter));
    });
    document.head.appendChild(script);
  });
}
