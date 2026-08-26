import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext, ResourceRef } from "@/lib/authz/can";
import { scopedUserWhere } from "@/lib/organizations/scoping";

/**
 * The authoritative "can this actor even see this User row" check — combines
 * the always-allowed self-view with scopedUserWhere (mirrors the RLS
 * user_select_* policies). Returns null for both "doesn't exist" and "not
 * visible to this actor", which is what lets callers return a uniform 404
 * without leaking which case it was (Segment 1 §6).
 */
export async function loadUserResource(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  userId: string
): Promise<{ user: Prisma.UserGetPayload<object>; resource: ResourceRef } | null> {
  const user = await tx.user.findFirst({
    where: { id: userId, OR: [{ id: auth.userId }, scopedUserWhere(auth)] },
  });
  if (!user) return null;

  return {
    user,
    resource: {
      type: "User",
      id: user.id,
      providerId: user.providerId,
      clientId: user.clientId,
      createdByUserId: user.createdByUserId,
    },
  };
}
