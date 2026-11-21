/**
 * The magomap pages allowed to talk to the extension. The one source for both the service
 * worker's `sender.origin` check and manifest.json's `externally_connectable.matches`
 * (written by vite.config.ts).
 *
 * The release build allows only production. The dev build (`pnpm build:dev`, Vite mode
 * "development") adds the local dev servers: in a release, any program serving those
 * common ports could otherwise read her Kakao Map lists.
 */
export const RELEASE_ORIGINS = ["https://magomap.jmn8718.workers.dev"] as const;
export const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:8787"] as const;

export function allowedOrigins(dev: boolean): readonly string[] {
  return dev ? [...RELEASE_ORIGINS, ...DEV_ORIGINS] : [...RELEASE_ORIGINS];
}

/** manifest.json's `externally_connectable.matches` for that build. */
export function connectableMatches(dev: boolean): string[] {
  return allowedOrigins(dev).map((origin) => `${origin}/*`);
}
