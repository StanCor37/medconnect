import crypto from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)])
    );
  }
  return value;
}

/** Sorted-keys JSON hash so two semantically-identical requests with different key order don't spuriously mismatch. */
export function hashRequestBody(body: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(body))).digest("hex");
}

export type IdempotencyCheckResult =
  | { kind: "new" }
  | { kind: "replay"; caseId: string }
  | { kind: "conflict" };

/**
 * Scoped per (providerId, key) since no API-key/integration-auth system
 * exists yet — this backs session-authenticated Case creation retries, not
 * a `cases:write` API scope. Same key + different body = a client error
 * (mismatched replay), not a legitimate retry.
 */
export async function checkIdempotencyKey(
  tx: Prisma.TransactionClient,
  providerId: string,
  key: string,
  requestHash: string
): Promise<IdempotencyCheckResult> {
  const existing = await tx.idempotencyKey.findUnique({
    where: { providerId_key: { providerId, key } },
  });
  if (!existing) return { kind: "new" };
  if (existing.requestHash !== requestHash) return { kind: "conflict" };
  return { kind: "replay", caseId: existing.caseId };
}
