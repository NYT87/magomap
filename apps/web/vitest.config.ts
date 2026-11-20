import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { readBuildInfo } from "./build-info";

const build = readBuildInfo();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
    __APP_BUILT_AT__: JSON.stringify(build.builtAt ?? ""),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "build-info.test.ts"],
    testTimeout: 30_000,
  },
});
