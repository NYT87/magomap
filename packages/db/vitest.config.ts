import { defineConfig } from "vitest/config";

// Postgres-backed tests make several round trips per write (per-user write check);
// under machine load the 5 s default is too tight.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
