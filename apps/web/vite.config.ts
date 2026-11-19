import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite-pwa-org.netlify.app/guide/ (generateSW), https://developer.chrome.com/docs/workbox/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/*"],
      manifest: {
        name: "magomap",
        short_name: "magomap",
        description: "Your own map of places and visits.",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#1F6F5C",
        background_color: "#FBF8F2",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        runtimeCaching: [
          {
            // Pretendard subsets load on demand; keep each once used, for offline starts.
            urlPattern: ({ request }) => request.destination === "font",
            handler: "CacheFirst",
            options: {
              cacheName: "mm-fonts",
              expiration: { maxEntries: 200, maxAgeSeconds: 365 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "mm-osm-tiles",
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Kakao hosts are never cached (their terms, and their tiles change).
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
