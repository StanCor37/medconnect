import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must be set to run tests — point it at a dedicated Neon branch, never at DATABASE_URL"
  );
}

const adapter = new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL });

/**
 * A bare Prisma client connected to the dedicated `test` Neon branch (a
 * schema-only clone of production — same tables/constraints/RLS policies,
 * zero data). Still the OWNER connection on that branch, so RLS is bypassed
 * here too (see README's RLS TODO) — tests exercise the real
 * application-layer scoping functions directly, since that scoping *is* the
 * current authorization boundary.
 */
export const testDb = new PrismaClient({ adapter });

export function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
