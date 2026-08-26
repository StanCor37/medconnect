import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/loadEnv.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    fileParallelism: false, // tests share one real Postgres database — avoid cross-file interleaving
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
