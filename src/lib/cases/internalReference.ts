import type { Prisma } from "@/generated/prisma/client";

/**
 * Atomic MC-YYYY-NNNNNNN generator. Uses an upsert against a per-year
 * counter row (not `SELECT count(*)` — that races under concurrency — and
 * not a raw per-year Postgres SEQUENCE, which would need dynamic DDL from
 * application code at year rollover). Postgres serializes concurrent
 * `INSERT ... ON CONFLICT DO UPDATE` on the same key via a row lock, so this
 * is race-free regardless of concurrent callers.
 */
export async function generateInternalReference(
  tx: Prisma.TransactionClient,
  now: Date = new Date()
): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "CaseSequence" ("year", "lastValue")
    VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastValue" = "CaseSequence"."lastValue" + 1
    RETURNING "lastValue"
  `;
  const seq = rows[0].lastValue;
  return `MC-${year}-${String(seq).padStart(7, "0")}`;
}
