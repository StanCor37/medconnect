import type { Prisma } from "@/generated/prisma/client";

/**
 * Pure DB session operation, deliberately NOT guarded by "server-only"
 * (unlike src/lib/session.ts) so service-layer code (src/lib/accounts/service.ts)
 * can call it from a plain Node/Vitest test run, not just inside a Next
 * request. Takes `tx` rather than a module-level client so the revoke lands
 * in the SAME transaction as the status update and audit event it
 * accompanies (previously used a separate global client, which broke
 * atomicity and, once tests started pointing at a different database than
 * the app's dev connection, would have silently revoked sessions in the
 * wrong database entirely).
 */
export async function revokeAllSessionsForUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
