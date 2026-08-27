import type { Prisma } from "@/generated/prisma/client";

export interface DocumentTypeOption {
  code: string;
  name: string;
}

/** Used when a Case has no Validation Scheme pinned — spec §4: "Do not reject a document merely because its type is not yet known." */
export const GENERAL_DOCUMENT_TYPES: DocumentTypeOption[] = [
  { code: "medical_report", name: "Medical report" },
  { code: "invoice", name: "Invoice" },
  { code: "referral", name: "Referral" },
  { code: "passport", name: "Passport" },
  { code: "policy_coverage", name: "Policy / coverages" },
  { code: "guarantee_of_payment", name: "Guarantee of Payment (GOP)" },
  { code: "bank_card", name: "Bank card" },
  { code: "patient_form", name: "Patient form" },
  { code: "identity_document", name: "Identity document" },
];

/**
 * Always synthesized in code, never a seeded DB row — guarantees spec §4's
 * "Always provide: Other document" invariant holds for every Scheme, past
 * and future, without relying on every Scheme author remembering to add it.
 */
export const OTHER_DOCUMENT_TYPE: DocumentTypeOption = { code: "other_document", name: "Other document" };

/**
 * Type selector shows types from the Case's pinned Scheme version; falls
 * back to a hardcoded general list when no Scheme is pinned (spec §4).
 */
export async function resolveAvailableDocumentTypesForCase(
  tx: Prisma.TransactionClient,
  caseRow: { validationSchemeVersionId: string | null }
): Promise<DocumentTypeOption[]> {
  if (caseRow.validationSchemeVersionId) {
    const defs = await tx.documentTypeDefinition.findMany({
      where: { schemeVersionId: caseRow.validationSchemeVersionId, active: true },
      orderBy: { displayOrder: "asc" },
    });
    return [...defs.map((d) => ({ code: d.code, name: d.name })), OTHER_DOCUMENT_TYPE];
  }
  return [...GENERAL_DOCUMENT_TYPES, OTHER_DOCUMENT_TYPE];
}

export async function isValidDocumentTypeCodeForCase(
  tx: Prisma.TransactionClient,
  caseRow: { validationSchemeVersionId: string | null },
  code: string
): Promise<boolean> {
  const available = await resolveAvailableDocumentTypesForCase(tx, caseRow);
  return available.some((t) => t.code === code);
}
