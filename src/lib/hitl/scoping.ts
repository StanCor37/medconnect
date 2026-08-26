import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";

/** Same "impossible" sentinel precedent as NEVER_MATCH_CASE_WHERE — Super Admin gets zero HITL visibility, same as zero Case visibility. */
export const NEVER_MATCH_HITL_TASK_WHERE: Prisma.HitlTaskWhereInput = {
  id: "impossible-super-admin-must-never-see-hitl-tasks",
};

/**
 * Mirrors scopedCaseWhere exactly, joined through the parent Case. The
 * active-relationship re-check here (not just at task-creation time) is
 * what makes "Client HITL requires Client association and active
 * relationship" (spec §29) a continuously-enforced guarantee rather than a
 * point-in-time one — a relationship suspended after a task was created
 * immediately makes that task invisible/undecidable again.
 */
export function scopedHitlTaskWhere(auth: AuthContext): Prisma.HitlTaskWhereInput {
  if (auth.role === "super_admin") {
    return NEVER_MATCH_HITL_TASK_WHERE;
  }
  if (auth.role === "client_admin") {
    return {
      assignedClientId: auth.clientId!,
      case: { providerClientRelationship: { status: "active" } },
    };
  }
  // provider_user: read-only, ownership established through the parent Case.
  return {
    case: {
      providerId: auth.providerId!,
      OR: [
        { providerCaseAccess: "provider_shared" },
        { providerCaseAccess: "creator_only", createdByUserId: auth.userId },
      ],
    },
  };
}
