import type { Prisma } from "@/generated/prisma/client";

/**
 * The plain object evaluateDeterministicRule.ts's resolveFieldPath already
 * knows how to walk via dot-notation — "documents.invoice",
 * "fields.invoice.total_cost", "case.eventDate" — matching the convention
 * already baked into seeded Rule definitions (see prisma/seed.ts).
 */
export interface ResolvedValidationInput {
  case: Record<string, unknown>;
  documents: Record<string, boolean>;
  fields: Record<string, Record<string, unknown>>;
}

const UNUSABLE_STATUSES = new Set(["absent", "invalid", "failed"]);

/**
 * Documented V1 limitation (inherited from the rest of the rule engine, not
 * newly introduced here): when a Document Type allows multiple Documents
 * and several share a type, only the most-recently-created one's current
 * version feeds `documents.<code>`/`fields.<code>.*` — DeterministicOperation
 * has no per-instance iteration construct, so evaluating "all instances"
 * separately was never possible to begin with.
 */
export async function buildResolvedInput(tx: Prisma.TransactionClient, caseRow: { id: string; eventDate: Date | null; patientReference: string | null; serviceType: string | null; insurerId: string | null; clientId: string | null; caseMode: string }): Promise<ResolvedValidationInput> {
  const documents = await tx.document.findMany({
    where: { caseId: caseRow.id, archivedAt: null },
    include: { currentVersion: true },
    orderBy: { createdAt: "asc" },
  });

  const latestByType = new Map<string, (typeof documents)[number]>();
  for (const doc of documents) {
    if (!doc.documentTypeCode || !doc.currentVersionId || !doc.currentVersion) continue;
    latestByType.set(doc.documentTypeCode, doc); // orderBy asc — last write per type wins, i.e. most recent
  }

  const documentsPresence: Record<string, boolean> = {};
  const fieldsByType: Record<string, Record<string, unknown>> = {};

  for (const [code, doc] of latestByType) {
    documentsPresence[code] = true; // presence = confirmed type + a current version exists; readability is its own separate requirement check

    const extractedFields = await tx.extractedField.findMany({
      where: { documentVersionId: doc.currentVersionId! },
      include: { fieldDefinition: true },
    });
    const values: Record<string, unknown> = {};
    for (const ef of extractedFields) {
      if (UNUSABLE_STATUSES.has(ef.status)) continue;
      const value = ef.confirmedValue ?? ef.normalizedValue;
      if (value === null || value === undefined) continue;
      values[ef.fieldDefinition.code] = value;
    }
    fieldsByType[code] = values;
  }

  return {
    case: {
      eventDate: caseRow.eventDate,
      patientReference: caseRow.patientReference,
      serviceType: caseRow.serviceType,
      insurerId: caseRow.insurerId,
      clientId: caseRow.clientId,
      caseMode: caseRow.caseMode,
    },
    documents: documentsPresence,
    fields: fieldsByType,
  };
}
