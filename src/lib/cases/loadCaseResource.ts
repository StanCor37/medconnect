import type { Prisma } from "@/generated/prisma/client";
import type { ResourceRef } from "@/lib/authz/can";

export async function loadCaseResource(
  tx: Prisma.TransactionClient,
  caseId: string
): Promise<{ caseRow: Prisma.CaseGetPayload<object>; resource: ResourceRef } | null> {
  const caseRow = await tx.case.findUnique({ where: { id: caseId } });
  if (!caseRow) return null;
  return {
    caseRow,
    resource: {
      type: "Case",
      id: caseRow.id,
      providerId: caseRow.providerId,
      clientId: caseRow.clientId,
      providerCaseAccess: caseRow.providerCaseAccess,
      createdByUserId: caseRow.createdByUserId,
    },
  };
}
