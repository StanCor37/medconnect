import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";

/**
 * Same shape as cases/scoping.ts's NEVER_MATCH_CASE_WHERE — Super Admin gets
 * ZERO Document visibility, not even a governance carve-out (spec §25:
 * "Super Admin is always denied"). "Document authorization inherits from the
 * Case" is implemented literally here.
 */
export const NEVER_MATCH_DOCUMENT_WHERE: Prisma.DocumentWhereInput = {
  id: "impossible-super-admin-must-never-see-documents",
};

/** Mirrors scopedCaseWhere exactly, joined through Document.case. */
export function scopedDocumentWhere(auth: AuthContext): Prisma.DocumentWhereInput {
  if (auth.role === "super_admin") {
    return NEVER_MATCH_DOCUMENT_WHERE;
  }
  if (auth.role === "client_admin") {
    return {
      case: { clientId: auth.clientId!, providerClientRelationship: { status: "active" } },
    };
  }
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
