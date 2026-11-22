import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { connectableMatches } from "./src/origins.ts";

// One service worker file, plus manifest.json with `externally_connectable` added for this
// build. No minifying, so what Chrome runs (and what readInPage serialises into the Kakao
// Map page) stays readable.
//
// `vite build` is the release build: only production magomap may connect.
// `vite build --mode development` (`build:dev`) also lets the local dev servers connect.
export default defineConfig(({ mode }) => {
  const dev = mode === "development";
  return {
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
          const manifest = JSON.parse(
            readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
          ) as Record<string, unknown>;
          manifest.externally_connectable = { matches: connectableMatches(dev) };
          for (const icon of readdirSync(new URL("./icons/", import.meta.url))) {
            this.emitFile({
              type: "asset",
              fileName: `icons/${icon}`,
              source: readFileSync(new URL(`./icons/${icon}`, import.meta.url)),
            });
          }
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: `${JSON.stringify(manifest, null, 2)}\n`,
          });
        },
      },
    ],
  };
});
