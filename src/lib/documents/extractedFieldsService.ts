import { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
import { can } from "@/lib/authz/can";
import { loadDocumentResource } from "@/lib/documents/loadDocumentResource";
import { scopedDocumentWhere } from "@/lib/documents/scoping";
import { normalizeExtractedValue } from "@/lib/processing/normalize";
import { writeAuditEvent } from "@/lib/audit/record";
import { DocumentServiceError } from "@/lib/documents/service";

/**
 * Read-only lookup for the two GET-backed functions below. `document.view`'s
 * own `can()` policy deliberately does no ownership check for provider_user/
 * client_admin (see can.ts's comment) — every other read route enforces
 * visibility via `scopedDocumentWhere` in the query itself instead, and this
 * must do the same rather than relying on `loadDocumentResource`'s unscoped
 * fetch, which is only safe for the mutation actions (caseMutationPolicy
 * *does* check ownership).
 */
async function loadVisibleDocument(tx: Prisma.TransactionClient, actor: AuthContext, documentId: string) {
  const documentRow = await tx.document.findFirst({ where: { AND: [{ id: documentId }, scopedDocumentWhere(actor)] } });
  if (!documentRow) throw new DocumentServiceError("not_found", "Document not found");
  const caseRow = await tx.case.findUniqueOrThrow({ where: { id: documentRow.caseId } });
  return { documentRow, caseRow };
}

/**
 * Shared by all three actions below: load Document+Case, authorize, verify
 * the type is actually confirmed (nothing to review before that), then
 * resolve the ExtractionFieldDefinition and confirm it genuinely belongs to
 * this Document's confirmed type + the Case's pinned Scheme version — never
 * trust a client-supplied fieldDefinitionId at face value.
 */
async function loadReviewContext(tx: Prisma.TransactionClient, actor: AuthContext, documentId: string, fieldDefinitionId: string) {
  const found = await loadDocumentResource(tx, documentId);
  if (!found) throw new DocumentServiceError("not_found", "Document not found");
  const decision = can(actor, "document.reviewExtraction", found.resource);
  if (!decision.allowed) throw new DocumentServiceError(decision.status === 404 ? "not_found" : "forbidden", "Not allowed");

  const { documentRow, caseRow } = found;
  if (!documentRow.currentVersionId || !documentRow.documentTypeCode) {
    throw new DocumentServiceError("not_classified", "This Document's type has not been confirmed yet");
  }

  const documentType = await tx.documentTypeDefinition.findFirst({
    where: { schemeVersionId: caseRow.validationSchemeVersionId ?? undefined, code: documentRow.documentTypeCode },
  });
  const fieldDefinition = documentType
    ? await tx.extractionFieldDefinition.findFirst({ where: { id: fieldDefinitionId, documentTypeId: documentType.id } })
    : null;
  if (!fieldDefinition) throw new DocumentServiceError("not_found", "That field is not part of this Document's type");

  return { documentRow, caseRow, fieldDefinition, documentVersionId: documentRow.currentVersionId };
}

export async function confirmExtractedFieldService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  documentId: string,
  fieldDefinitionId: string
) {
  const { documentRow, caseRow, documentVersionId } = await loadReviewContext(tx, actor, documentId, fieldDefinitionId);

  const existing = await tx.extractedField.findUnique({
    where: { documentVersionId_fieldDefinitionId: { documentVersionId, fieldDefinitionId } },
  });
  if (!existing) throw new DocumentServiceError("invalid_state", "There is no extracted value to confirm for this field yet");

  const updated = await tx.extractedField.update({
    where: { id: existing.id },
    data: { status: "confirmed", confirmedValue: existing.normalizedValue ?? Prisma.JsonNull, confirmedByUserId: actor.userId, confirmedAt: new Date() },
    include: { fieldDefinition: true },
  });

  await writeAuditEvent(tx, {
    eventType: "extracted_field_confirmed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: caseRow.providerId,
    clientId: caseRow.clientId,
    caseId: documentRow.caseId,
    targetType: "ExtractedField",
    targetId: updated.id,
    action: "confirm",
    source: "api",
  });

  return updated;
}

export async function correctExtractedFieldService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  documentId: string,
  fieldDefinitionId: string,
  rawValue: string,
  reason: string | undefined
) {
  const { documentRow, caseRow, fieldDefinition, documentVersionId } = await loadReviewContext(tx, actor, documentId, fieldDefinitionId);

  const { normalizedValue, ok } = normalizeExtractedValue(rawValue, fieldDefinition.valueType);
  if (!ok) {
    throw new DocumentServiceError("invalid_value", `"${rawValue}" could not be understood as a ${fieldDefinition.valueType} value`);
  }

  const updated = await tx.extractedField.upsert({
    where: { documentVersionId_fieldDefinitionId: { documentVersionId, fieldDefinitionId } },
    create: {
      caseId: documentRow.caseId,
      documentId,
      documentVersionId,
      fieldDefinitionId,
      valueType: fieldDefinition.valueType,
      extractionMethod: "provider_entered",
      status: "corrected",
      confirmedValue: normalizedValue === null ? Prisma.JsonNull : normalizedValue,
      confirmedByUserId: actor.userId,
      confirmedAt: new Date(),
      correctionReason: reason ?? null,
    },
    update: {
      // rawValue/normalizedValue are the ORIGINAL machine values and are
      // deliberately left untouched (spec §1/§17) — only confirmedValue
      // reflects the Provider's correction.
      status: "corrected",
      confirmedValue: normalizedValue === null ? Prisma.JsonNull : normalizedValue,
      confirmedByUserId: actor.userId,
      confirmedAt: new Date(),
      correctionReason: reason ?? null,
    },
    include: { fieldDefinition: true },
  });

  await writeAuditEvent(tx, {
    eventType: "extracted_field_corrected",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: caseRow.providerId,
    clientId: caseRow.clientId,
    caseId: documentRow.caseId,
    targetType: "ExtractedField",
    targetId: updated.id,
    action: "correct",
    source: "api",
  });

  return updated;
}

export async function markExtractedFieldAbsentService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  documentId: string,
  fieldDefinitionId: string
) {
  const { documentRow, caseRow, fieldDefinition, documentVersionId } = await loadReviewContext(tx, actor, documentId, fieldDefinitionId);

  const updated = await tx.extractedField.upsert({
    where: { documentVersionId_fieldDefinitionId: { documentVersionId, fieldDefinitionId } },
    create: {
      caseId: documentRow.caseId,
      documentId,
      documentVersionId,
      fieldDefinitionId,
      valueType: fieldDefinition.valueType,
      extractionMethod: "provider_entered",
      status: "absent",
      confirmedValue: Prisma.JsonNull,
      confirmedByUserId: actor.userId,
      confirmedAt: new Date(),
    },
    update: {
      status: "absent",
      confirmedValue: Prisma.JsonNull,
      confirmedByUserId: actor.userId,
      confirmedAt: new Date(),
    },
    include: { fieldDefinition: true },
  });

  await writeAuditEvent(tx, {
    eventType: "extracted_field_marked_absent",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: caseRow.providerId,
    clientId: caseRow.clientId,
    caseId: documentRow.caseId,
    targetType: "ExtractedField",
    targetId: updated.id,
    action: "mark_absent",
    source: "api",
  });

  return updated;
}

/** Every ExtractionFieldDefinition for this Document's confirmed type, merged with any existing ExtractedField — [] until a type is confirmed. */
export async function listExtractedFieldsService(tx: Prisma.TransactionClient, actor: AuthContext, documentId: string) {
  const { documentRow, caseRow } = await loadVisibleDocument(tx, actor, documentId);
  if (!documentRow.currentVersionId || !documentRow.documentTypeCode || !caseRow.validationSchemeVersionId) return [];

  const documentType = await tx.documentTypeDefinition.findFirst({
    where: { schemeVersionId: caseRow.validationSchemeVersionId, code: documentRow.documentTypeCode },
    include: { extractionFieldDefinitions: { orderBy: { displayOrder: "asc" } } },
  });
  if (!documentType) return [];

  const existingFields = await tx.extractedField.findMany({
    where: { documentVersionId: documentRow.currentVersionId, fieldDefinitionId: { in: documentType.extractionFieldDefinitions.map((f) => f.id) } },
  });
  const byFieldId = new Map(existingFields.map((f) => [f.fieldDefinitionId, f]));

  return documentType.extractionFieldDefinitions.map((fieldDefinition) => {
    const existing = byFieldId.get(fieldDefinition.id);
    return {
      fieldDefinitionId: fieldDefinition.id,
      code: fieldDefinition.code,
      label: fieldDefinition.label,
      valueType: fieldDefinition.valueType,
      required: fieldDefinition.required,
      status: existing?.status ?? "not_extracted",
      rawValue: existing?.rawValue ?? null,
      normalizedValue: existing?.normalizedValue ?? null,
      confirmedValue: existing?.confirmedValue ?? null,
      confidence: existing?.confidence ?? null,
      confirmedByUserId: existing?.confirmedByUserId ?? null,
      confirmedAt: existing?.confirmedAt ?? null,
      correctionReason: existing?.correctionReason ?? null,
    };
  });
}

/** The latest DocumentClassificationResult for this Document's current version, or null. */
export async function getClassificationResultService(tx: Prisma.TransactionClient, actor: AuthContext, documentId: string) {
  const { documentRow } = await loadVisibleDocument(tx, actor, documentId);
  if (!documentRow.currentVersionId) return null;
  return tx.documentClassificationResult.findFirst({
    where: { documentVersionId: documentRow.currentVersionId },
    orderBy: { createdAt: "desc" },
  });
}
