import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const api = { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 20000,
  },
});
