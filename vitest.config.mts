import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["server/test-setup.ts"],
  },
});
