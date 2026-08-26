import type { Prisma } from "@/generated/prisma/client";

/**
 * Spec §19: a strict two-way check, unlike the three-way exact/probable/
 * no_match shape used by Case/Rule/Provider — the spec gives no "confirm and
 * proceed anyway" override for documents (only "Open existing document" /
 * "Cancel upload"), so there is deliberately no confirmedNotDuplicateBy-style
 * bypass here.
 */
export type DocumentDuplicateResult =
  | { kind: "exact_match"; documentId: string; sourceFileId: string }
  | { kind: "no_match" };

/**
 * Scoped strictly to `caseId` — never reveals a match from an inaccessible
 * Case (spec §19's "do not reveal matches from inaccessible Cases").
 */
export async function checkForDuplicateDocumentInCase(
  tx: Prisma.TransactionClient,
  caseId: string,
  contentHash: string
): Promise<DocumentDuplicateResult> {
  const match = await tx.sourceFile.findFirst({
    where: { caseId, contentHash },
    select: { id: true, versions: { select: { documentId: true }, take: 1 } },
  });
  if (match && match.versions.length > 0) {
    return { kind: "exact_match", documentId: match.versions[0].documentId, sourceFileId: match.id };
  }
  return { kind: "no_match" };
}
