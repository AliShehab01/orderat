import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "src/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["server/test-setup.ts"],
    // PGlite (server/agent/postgres-store.test.ts) starts a real WASM Postgres; its one-time
    // instantiation + migration can take a few seconds on a slow/loaded machine, longer than
    // vitest's 10s default hook timeout.
    hookTimeout: 45000,
  },
});
