import type { Prisma } from "@/generated/prisma/client";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ExistingUserOutcome =
  | { kind: "none" }
  | { kind: "active"; userId: string }
  | { kind: "invited"; userId: string }
  | { kind: "suspended"; userId: string }
  | { kind: "deactivated"; userId: string };

/**
 * Finds any existing account for a normalized email. Callers must branch on
 * the outcome per Segment 2 §10 rather than creating a second account:
 * active -> offer the connection/invite flow instead; invited -> offer
 * resend/reset; suspended/deactivated -> require an authorized admin to
 * restore. Never auto-merge.
 */
export async function findExistingUserByEmail(
  tx: Prisma.TransactionClient,
  email: string
): Promise<ExistingUserOutcome> {
  const normalized = normalizeEmail(email);
  const user = await tx.user.findUnique({ where: { email: normalized } });
  if (!user) return { kind: "none" };
  return { kind: user.status, userId: user.id };
}
