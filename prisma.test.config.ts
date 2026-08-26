import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Points the Prisma CLI at the dedicated test Neon branch instead of
 * DATABASE_URL. Used only for keeping the test branch's schema in sync —
 * the app and the test suite itself never load this file (the app reads
 * prisma.config.ts; tests/setup/testDb.ts connects directly via
 * TEST_DATABASE_URL, not through the Prisma CLI's config resolution).
 *
 * Usage: npx prisma migrate deploy --config prisma.test.config.ts
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("TEST_DATABASE_URL"),
  },
});
