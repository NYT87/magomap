import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { DEFAULT_APP_URL } from "./scripts/check-pages";

// APP_URL (the deployed app) and SITE_URL (this homepage) are read at build time.
const APP_URL = process.env.APP_URL || DEFAULT_APP_URL;
const SITE_URL = (process.env.SITE_URL || "https://nyt87.github.io/magomap").replace(/\/$/, "");

const inject = (): Plugin => ({
  name: "magomap-urls",
  transformIndexHtml: (html) =>
    html.replaceAll("%APP_URL%", APP_URL).replaceAll("%SITE_URL%", SITE_URL),
});

// English is the default at the root; Korean lives under ko/.
const pages = ["", "get-started/", "privacy/", "ko/", "ko/get-started/", "ko/privacy/"];

export default defineConfig({
  base: "/magomap/",
  plugins: [inject()],
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((p) => [p || "home", resolve(import.meta.dirname, `${p}index.html`)]),
      ),
    },
  },
});
