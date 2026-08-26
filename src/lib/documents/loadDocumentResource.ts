import type { Prisma } from "@/generated/prisma/client";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";

/**
 * Loads a Document unscoped, then its parent Case via the existing
 * loadCaseResource — returning the Case's ResourceRef, since "document.*"
 * authorization reuses caseMutationPolicy verbatim (spec §25: "Document
 * authorization inherits from the Case").
 */
export async function loadDocumentResource(tx: Prisma.TransactionClient, documentId: string) {
  const documentRow = await tx.document.findUnique({ where: { id: documentId } });
  if (!documentRow) return null;
  const caseFound = await loadCaseResource(tx, documentRow.caseId);
  if (!caseFound) return null; // defensive — the FK guarantees this never happens
  return { documentRow, caseRow: caseFound.caseRow, resource: caseFound.resource };
}
