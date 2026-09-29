import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Several tests load hundreds of records through the API; on a busy machine 5 s is not enough.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
