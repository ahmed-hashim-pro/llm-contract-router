import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Adapters are thin translation layers over vendor SDKs; they are covered
      // by contract tests against fakes rather than by exercising real clients.
      reporter: ["text", "lcov"],
    },
  },
});
