import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: ":memory:",
      SIMULATOR_DATABASE_URL: ":memory:",
      MAXIMO_MODE: "simulation",
    },
  },
});
