import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// One service worker file, plus manifest.json copied as is. No minifying, so what Chrome
// runs (and what readInPage serialises into the Kakao Map page) stays readable.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    minify: false,
    rolldownOptions: {
      input: "src/background.ts",
      output: { format: "es", entryFileNames: "background.js" },
    },
  },
  plugins: [
    {
      name: "magomap-extension-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "manifest.json",
          source: readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
        });
      },
    },
  ],
});
