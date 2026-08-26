import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";

/**
 * Deliberately not `{}` — a blank where-clause would accidentally leak every
 * Case to Super Admin if this function were ever copy-pasted the way the
 * other scoped*Where functions are. Super Admin is the one role that gets
 * ZERO Case visibility, not even the standalone-only carve-out every other
 * resource type gives it (see can.ts and prisma/rls.sql for the same rule
 * enforced two more times, deliberately redundant).
 */
export const NEVER_MATCH_CASE_WHERE: Prisma.CaseWhereInput = {
  id: "impossible-super-admin-must-never-see-cases",
};

/**
 * Mirrors the Case RLS policies in prisma/rls.sql exactly. This IS the
 * authorization boundary today (RLS is dormant under the current
 * owner-level DB connection — see README) — every Case list/single-item
 * fetch must go through this, never a bare findMany/findUnique by id alone.
 */
export function scopedCaseWhere(auth: AuthContext): Prisma.CaseWhereInput {
  if (auth.role === "super_admin") {
    return NEVER_MATCH_CASE_WHERE;
  }
  if (auth.role === "client_admin") {
    return {
      clientId: auth.clientId!,
      providerClientRelationship: { status: "active" },
    };
  }
  // provider_user: own Provider's Cases, respecting providerCaseAccess — a
  // creator_only Case is invisible to everyone at this Provider except its creator.
  return {
    providerId: auth.providerId!,
    OR: [
      { providerCaseAccess: "provider_shared" },
      { providerCaseAccess: "creator_only", createdByUserId: auth.userId },
    ],
  };
}
