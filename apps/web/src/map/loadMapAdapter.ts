import type { PublicConfig } from "@magomap/domain";
import { createKakaoAdapter } from "./kakaoAdapter";
import { createLeafletAdapter } from "./leafletAdapter";
import type { MapAdapter } from "./MapAdapter";

const SDK = "https://dapi.kakao.com/v2/maps/sdk.js";

/** One load per key and page: switching maps never loads the Kakao SDK again. */
const sdkLoads = new Map<string, Promise<boolean>>();

/**
 * Loads the Kakao Maps SDK; true when it's ready to use. False without a key, when the script
 * fails, or when it doesn't load in time (8 s by default).
 */
export function loadKakaoSdk(
  key: string | null,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  if (!key) return Promise.resolve(false);
  const known = sdkLoads.get(key);
  if (known) return known;
  const load = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), opts.timeoutMs ?? 8_000);
    const script = document.createElement("script");
    script.src = `${SDK}?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`;
    script.async = true;
    script.addEventListener("error", () => finish(false));
    script.addEventListener("load", () => {
      const kakao = (window as unknown as { kakao?: { maps?: { load(cb: () => void): void } } })
        .kakao;
      if (!kakao?.maps) return finish(false);
      kakao.maps.load(() => finish(true));
    });
    document.head.appendChild(script);
  });
  sdkLoads.set(key, load);
  return load;
}

/** A new, unmounted map of that kind; Leaflet if Kakao's SDK turns out to be unusable. */
export function createAdapter(provider: MapAdapter["provider"]): MapAdapter {
  if (provider === "leaflet") return createLeafletAdapter();
  try {
    return createKakaoAdapter();
  } catch {
    return createLeafletAdapter();
  }
}

/** Kakao Maps when a key is set and the SDK loads in time; Leaflet + OpenStreetMap otherwise. */
export async function loadMapAdapter(
  config: PublicConfig,
  opts: { timeoutMs?: number } = {},
): Promise<MapAdapter> {
  const kakao = await loadKakaoSdk(config.kakaoJavascriptKey, opts);
  return createAdapter(kakao ? "kakao" : "leaflet");
}
