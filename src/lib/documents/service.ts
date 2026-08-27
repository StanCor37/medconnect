import crypto from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus, ClassificationStatus, DocumentStatus } from "@/generated/prisma/enums";
import type { AuthContext } from "@/lib/authz/can";
import type { StorageAdapter } from "@/lib/storage/StorageAdapter";
import { computeStorageKey } from "@/lib/storage/LocalFilesystemStorageAdapter";
import type { MalwareScanner } from "@/lib/documents/malwareScanner";
import type { OcrClient } from "@/lib/processing/ocrClient";
import { sniffMimeType } from "@/lib/documents/fileSignature";
import { countPdfPages } from "@/lib/documents/pdfPageCount";
import { checkPdfReadability } from "@/lib/documents/readabilityCheck";
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_UPLOAD, MAX_TOTAL_UPLOAD_BYTES } from "@/lib/documents/limits";
import { isValidDocumentTypeCodeForCase } from "@/lib/documents/documentTypes";
import { checkForDuplicateDocumentInCase } from "@/lib/duplicate-detection/document";
import { processAfterUpload, processAfterTypeConfirmed } from "@/lib/processing/pipeline";
import { writeAuditEvent } from "@/lib/audit/record";
import type { ReplacementReasonInput } from "@/lib/validation/document";
import { transitionCaseStatus } from "@/lib/cases/stateMachine";
import { CaseServiceError } from "@/lib/cases/errors";

export class DocumentServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function documentErrorStatus(code: string): number {
  switch (code) {
    case "invalid_document_type":
    case "not_classified":
    case "invalid_value":
      return 422;
    case "password_protected":
    case "corrupted_file":
      return 422;
    case "unsupported_format":
      return 415;
    case "file_too_large":
    case "too_many_files":
      return 413;
    case "duplicate_file":
      return 409;
    case "no_change":
      return 409;
    case "invalid_state":
      return 409;
    case "stale_version":
      return 409;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

type ExistingCaseForDocument = {
  providerId: string;
  clientId: string | null;
  providerCaseAccess: "creator_only" | "provider_shared";
  createdByUserId: string;
};

/**
 * Document authorization inherits from the Case (spec §25) — this mirrors
 * cases/service.ts's own private assertProviderUserOwnsCase exactly,
 * applied to the Document's parent Case row. Cross-Provider and
 * "creator_only, not the creator" both become "not_found" (404), never a
 * 403, matching the Case precedent this defers to.
 */
function assertProviderUserOwnsCase(actor: AuthContext, existing: ExistingCaseForDocument) {
  if (actor.role !== "provider_user" || existing.providerId !== actor.providerId) {
    throw new DocumentServiceError("not_found", "Case not found");
  }
  if (existing.providerCaseAccess === "creator_only" && existing.createdByUserId !== actor.userId) {
    throw new DocumentServiceError("not_found", "Case not found");
  }
}

/** classificationStatus !== "confirmed" -> needs_type_confirmation; else ready — no split confirmation is ever pending since no splits exist this phase, and malware "skipped" counts as passed. */
function computeDocumentStatus(classificationStatus: ClassificationStatus): DocumentStatus {
  return classificationStatus === "confirmed" ? "ready" : "needs_type_confirmation";
}

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Segment 8 §4/§7's document-driven phase advance: draft -> documents_in_progress
 * on the first (non-archived) Document; documents_in_progress /
 * provider_action_required -> ready_for_validation once a Scheme is pinned
 * and no Document is stuck needing type/split confirmation. Deliberately NOT
 * the full Segment 7 evaluateRequirements check — "ready" here only means
 * "a Provider can attempt validation", not "every required document/field is
 * present" (that distinction is what validation's own "incomplete" result is
 * for). Called after every document mutation; a no-op recalculation (already
 * at the right resting status, or the Case isn't in a document-phase status
 * at all — e.g. mid-validation, submitted, or terminal) is silently skipped.
 */
async function recalculateDocumentPhaseStatus(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string) {
  const caseRow = await tx.case.findUnique({ where: { id: caseId } });
  if (!caseRow) return;
  if (caseRow.status !== "draft" && caseRow.status !== "documents_in_progress" && caseRow.status !== "provider_action_required") {
    return;
  }

  const documentCount = await tx.document.count({ where: { caseId, archivedAt: null } });
  if (documentCount === 0) return;

  let target: CaseStatus;
  if (caseRow.status === "draft") {
    target = "documents_in_progress";
  } else {
    if (!caseRow.validationSchemeVersionId) return;
    const pendingCount = await tx.document.count({
      where: { caseId, archivedAt: null, status: { in: ["needs_type_confirmation", "needs_split_confirmation"] } },
    });
    if (pendingCount > 0) return;
    target = "ready_for_validation";
  }
  if (target === caseRow.status) return;

  try {
    await transitionCaseStatus(tx, actor, caseId, {
      toStatus: target,
      expectedVersion: caseRow.version,
      actorType: "system",
      source: "system",
    });
  } catch (err) {
    // A concurrent status change lost the race — the next mutation that
    // touches this Case will recalculate again, so this is safe to drop.
    if (err instanceof CaseServiceError && (err.code === "stale_version" || err.code === "invalid_transition")) return;
    throw err;
  }
}

export interface UploadFileInput {
  originalFilename: string;
  buffer: Buffer;
}

export interface UploadFileResult {
  filename: string;
  status: "created" | "duplicate" | "rejected";
  documentId?: string;
  versionId?: string;
  errorCode?: string;
  existingDocumentId?: string;
}

/**
 * Per file: sniff -> size/format reject -> hash -> duplicate check ->
 * readability pre-check -> page count -> validate type if given -> store ->
 * create SourceFile/Document/DocumentVersion/DocumentPageReferences -> audit.
 * One failed file must not fail the rest of the batch (spec §7) — every
 * per-file validation failure is caught and recorded as a result without
 * ever issuing a failing SQL statement, so the transaction is never
 * poisoned for the remaining files.
 */
export async function uploadDocumentsService(
  tx: Prisma.TransactionClient,
  storage: StorageAdapter,
  scanner: MalwareScanner,
  ocrClient: OcrClient,
  actor: AuthContext,
  caseId: string,
  files: UploadFileInput[],
  sharedDocumentTypeCode: string | undefined
): Promise<UploadFileResult[]> {
  const caseRow = await tx.case.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new DocumentServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, caseRow);

  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new DocumentServiceError("too_many_files", `A maximum of ${MAX_FILES_PER_UPLOAD} files can be uploaded at once`);
  }
  const totalBytes = files.reduce((sum, f) => sum + f.buffer.length, 0);
  if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
    throw new DocumentServiceError("file_too_large", "This upload's combined size exceeds the maximum allowed");
  }

  if (sharedDocumentTypeCode) {
    const valid = await isValidDocumentTypeCodeForCase(tx, caseRow, sharedDocumentTypeCode);
    if (!valid) throw new DocumentServiceError("invalid_document_type", "That Document Type is not available for this Case");
  }

  const results: UploadFileResult[] = [];

  for (const file of files) {
    try {
      const mimeType = sniffMimeType(file.buffer);
      if (!mimeType) {
        results.push({ filename: file.originalFilename, status: "rejected", errorCode: "unsupported_format" });
        continue;
      }
      if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
        results.push({ filename: file.originalFilename, status: "rejected", errorCode: "file_too_large" });
        continue;
      }
      if (mimeType === "application/pdf") {
        const rejection = checkPdfReadability(file.buffer);
        if (rejection) {
          results.push({ filename: file.originalFilename, status: "rejected", errorCode: rejection });
          continue;
        }
      }

      const contentHash = sha256Hex(file.buffer);
      const duplicate = await checkForDuplicateDocumentInCase(tx, caseId, contentHash);
      if (duplicate.kind === "exact_match") {
        results.push({
          filename: file.originalFilename,
          status: "duplicate",
          errorCode: "duplicate_file",
          existingDocumentId: duplicate.documentId,
        });
        continue;
      }

      const pageCount = mimeType === "application/pdf" ? countPdfPages(file.buffer) : 1;
      const scanResult = await scanner.scan(file.buffer); // always "skipped" this phase

      const sourceFileId = crypto.randomUUID();
      const storageKey = computeStorageKey(caseRow.providerId, caseId, sourceFileId);
      await storage.put(storageKey, file.buffer);

      await tx.sourceFile.create({
        data: {
          id: sourceFileId,
          caseId,
          providerId: caseRow.providerId,
          uploadedByUserId: actor.userId,
          originalFilename: file.originalFilename,
          mimeType,
          byteSize: file.buffer.length,
          contentHash,
          storageKey,
          malwareScanStatus: scanResult.status,
          pageCount,
        },
      });

      const classificationStatus: ClassificationStatus = sharedDocumentTypeCode ? "confirmed" : "pending";
      const document = await tx.document.create({
        data: {
          caseId,
          documentTypeCode: sharedDocumentTypeCode ?? null,
          status: computeDocumentStatus(classificationStatus),
          createdByUserId: actor.userId,
        },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          sourceFileId,
          readabilityStatus: "readable",
          classificationStatus,
          confirmedTypeCode: sharedDocumentTypeCode ?? null,
          createdByUserId: actor.userId,
        },
      });
      await tx.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
      await tx.documentPageReference.createMany({
        data: Array.from({ length: pageCount }, (_, i) => ({
          documentVersionId: version.id,
          sourceFileId,
          sourcePageNumber: i + 1,
          documentPageNumber: i + 1,
          rotation: 0,
          included: true,
        })),
      });

      await processAfterUpload(tx, ocrClient, {
        documentVersionId: version.id,
        buffer: file.buffer,
        mimeType,
        sourceFileContentHash: contentHash,
        originalFilename: file.originalFilename,
        schemeVersionId: caseRow.validationSchemeVersionId,
        confirmedTypeCode: sharedDocumentTypeCode ?? null,
        caseId,
        documentId: document.id,
      });

      await writeAuditEvent(tx, {
        eventType: "source_file_uploaded",
        actorUserId: actor.userId,
        actorRole: actor.role,
        providerId: caseRow.providerId,
        clientId: caseRow.clientId,
        caseId,
        targetType: "SourceFile",
        targetId: sourceFileId,
        action: "upload",
        source: "api",
      });
      await writeAuditEvent(tx, {
        eventType: "document_created",
        actorUserId: actor.userId,
        actorRole: actor.role,
        providerId: caseRow.providerId,
        clientId: caseRow.clientId,
        caseId,
        targetType: "Document",
        targetId: document.id,
        action: "create",
        source: "api",
      });
      await writeAuditEvent(tx, {
        eventType: "document_version_created",
        actorUserId: actor.userId,
        actorRole: actor.role,
        providerId: caseRow.providerId,
        clientId: caseRow.clientId,
        caseId,
        targetType: "DocumentVersion",
        targetId: version.id,
        action: "create",
        source: "api",
      });
      if (sharedDocumentTypeCode) {
        await writeAuditEvent(tx, {
          eventType: "document_type_confirmed",
          actorUserId: actor.userId,
          actorRole: actor.role,
          providerId: caseRow.providerId,
          clientId: caseRow.clientId,
          caseId,
          targetType: "Document",
          targetId: document.id,
          action: "confirm_type",
          source: "api",
        });
      }

      results.push({ filename: file.originalFilename, status: "created", documentId: document.id, versionId: version.id });
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        results.push({ filename: file.originalFilename, status: "rejected", errorCode: err.code });
        continue;
      }
      throw err;
    }
  }

  await recalculateDocumentPhaseStatus(tx, actor, caseId);

  return results;
}

/** Legal regardless of prior state — the Provider can "confirm or change" a type (spec §10). */
export async function confirmDocumentTypeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  documentId: string,
  expectedDocumentVersion: number,
  typeCode: string
) {
  const document = await tx.document.findUnique({
    where: { id: documentId },
    include: { currentVersion: { include: { sourceFile: true } }, case: true },
  });
  if (!document) throw new DocumentServiceError("not_found", "Document not found");
  assertProviderUserOwnsCase(actor, document.case);
  if (!document.currentVersion) throw new DocumentServiceError("invalid_state", "Document has no current version");

  const valid = await isValidDocumentTypeCodeForCase(tx, document.case, typeCode);
  if (!valid) throw new DocumentServiceError("invalid_document_type", "That Document Type is not available for this Case");

  const wasAlreadyConfirmed = document.currentVersion.classificationStatus === "confirmed";

  await tx.documentVersion.update({
    where: { id: document.currentVersion.id },
    data: { confirmedTypeCode: typeCode, classificationStatus: "confirmed" },
  });

  const bump = await tx.document.updateMany({
    where: { id: documentId, version: expectedDocumentVersion },
    data: { documentTypeCode: typeCode, status: computeDocumentStatus("confirmed"), version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new DocumentServiceError("stale_version", "This Document changed before your action was completed. Reload it and try again.");
  }

  await processAfterTypeConfirmed(tx, {
    caseId: document.caseId,
    documentId,
    documentVersionId: document.currentVersion.id,
    schemeVersionId: document.case.validationSchemeVersionId,
    confirmedTypeCode: typeCode,
    sourceFileContentHash: document.currentVersion.sourceFile.contentHash,
  });

  const updated = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { currentVersion: true } });

  await writeAuditEvent(tx, {
    eventType: wasAlreadyConfirmed ? "document_type_changed" : "document_type_confirmed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: document.case.providerId,
    clientId: document.case.clientId,
    caseId: document.caseId,
    targetType: "Document",
    targetId: documentId,
    action: "confirm_type",
    source: "api",
  });

  await recalculateDocumentPhaseStatus(tx, actor, document.caseId);

  return updated;
}

/**
 * Creates a new immutable DocumentVersion, moves currentVersionId, and
 * leaves the previous version's fields completely untouched — spec §17's
 * "invalidate dependent results"/"notify the Client" are no-ops this phase
 * (nothing exists yet to invalidate or notify), but the untouched-old-version
 * guarantee is real and testable now.
 */
export async function replaceDocumentVersionService(
  tx: Prisma.TransactionClient,
  storage: StorageAdapter,
  scanner: MalwareScanner,
  ocrClient: OcrClient,
  actor: AuthContext,
  documentId: string,
  expectedDocumentVersion: number,
  input: { file: UploadFileInput; replacementReason: ReplacementReasonInput; documentTypeCode?: string }
) {
  const document = await tx.document.findUnique({
    where: { id: documentId },
    include: { currentVersion: { include: { sourceFile: true } }, case: true },
  });
  if (!document) throw new DocumentServiceError("not_found", "Document not found");
  assertProviderUserOwnsCase(actor, document.case);
  if (!document.currentVersion) throw new DocumentServiceError("invalid_state", "Document has no current version");

  const { file, replacementReason, documentTypeCode } = input;

  const mimeType = sniffMimeType(file.buffer);
  if (!mimeType) throw new DocumentServiceError("unsupported_format", "Unsupported or unrecognized file format");
  if (file.buffer.length > MAX_FILE_SIZE_BYTES) throw new DocumentServiceError("file_too_large", "File exceeds the maximum allowed size");
  if (mimeType === "application/pdf") {
    const rejection = checkPdfReadability(file.buffer);
    if (rejection) {
      throw new DocumentServiceError(
        rejection,
        rejection === "password_protected" ? "This file is password-protected" : "This file could not be read"
      );
    }
  }

  const contentHash = sha256Hex(file.buffer);
  if (contentHash === document.currentVersion.sourceFile.contentHash) {
    throw new DocumentServiceError("no_change", "This is identical to the current version — nothing to replace");
  }
  const duplicate = await checkForDuplicateDocumentInCase(tx, document.caseId, contentHash);
  if (duplicate.kind === "exact_match" && duplicate.documentId !== documentId) {
    throw new DocumentServiceError("duplicate_file", "This file has already been uploaded to this Case as a different Document");
  }

  const resolvedTypeCode = documentTypeCode ?? document.currentVersion.confirmedTypeCode ?? undefined;
  if (resolvedTypeCode) {
    const valid = await isValidDocumentTypeCodeForCase(tx, document.case, resolvedTypeCode);
    if (!valid) throw new DocumentServiceError("invalid_document_type", "That Document Type is not available for this Case");
  }

  const pageCount = mimeType === "application/pdf" ? countPdfPages(file.buffer) : 1;
  const scanResult = await scanner.scan(file.buffer);

  const sourceFileId = crypto.randomUUID();
  const storageKey = computeStorageKey(document.case.providerId, document.caseId, sourceFileId);
  await storage.put(storageKey, file.buffer);

  await tx.sourceFile.create({
    data: {
      id: sourceFileId,
      caseId: document.caseId,
      providerId: document.case.providerId,
      uploadedByUserId: actor.userId,
      originalFilename: file.originalFilename,
      mimeType,
      byteSize: file.buffer.length,
      contentHash,
      storageKey,
      malwareScanStatus: scanResult.status,
      pageCount,
    },
  });

  const classificationStatus: ClassificationStatus = resolvedTypeCode ? "confirmed" : "pending";
  const newVersion = await tx.documentVersion.create({
    data: {
      documentId,
      versionNumber: document.currentVersion.versionNumber + 1,
      sourceFileId,
      readabilityStatus: "readable",
      classificationStatus,
      confirmedTypeCode: resolvedTypeCode ?? null,
      replacesVersionId: document.currentVersion.id,
      replacementReason,
      createdByUserId: actor.userId,
    },
  });
  await tx.documentPageReference.createMany({
    data: Array.from({ length: pageCount }, (_, i) => ({
      documentVersionId: newVersion.id,
      sourceFileId,
      sourcePageNumber: i + 1,
      documentPageNumber: i + 1,
      rotation: 0,
      included: true,
    })),
  });

  await processAfterUpload(tx, ocrClient, {
    documentVersionId: newVersion.id,
    buffer: file.buffer,
    mimeType,
    sourceFileContentHash: contentHash,
    originalFilename: file.originalFilename,
    schemeVersionId: document.case.validationSchemeVersionId,
    confirmedTypeCode: resolvedTypeCode ?? null,
    caseId: document.caseId,
    documentId,
  });

  const bump = await tx.document.updateMany({
    where: { id: documentId, version: expectedDocumentVersion },
    data: {
      currentVersionId: newVersion.id,
      documentTypeCode: resolvedTypeCode ?? null,
      status: computeDocumentStatus(classificationStatus),
      version: { increment: 1 },
    },
  });
  if (bump.count === 0) {
    throw new DocumentServiceError("stale_version", "This Document changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { currentVersion: true } });

  await writeAuditEvent(tx, {
    eventType: "document_version_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: document.case.providerId,
    clientId: document.case.clientId,
    caseId: document.caseId,
    targetType: "DocumentVersion",
    targetId: newVersion.id,
    action: "replace",
    source: "api",
  });
  await writeAuditEvent(tx, {
    eventType: "document_replaced",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: document.case.providerId,
    clientId: document.case.clientId,
    caseId: document.caseId,
    targetType: "Document",
    targetId: documentId,
    action: "replace",
    source: "api",
    reasonCode: replacementReason,
  });

  await recalculateDocumentPhaseStatus(tx, actor, document.caseId);

  return updated;
}

export async function archiveDocumentService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  documentId: string,
  expectedVersion: number
) {
  const document = await tx.document.findUnique({ where: { id: documentId }, include: { case: true } });
  if (!document) throw new DocumentServiceError("not_found", "Document not found");
  assertProviderUserOwnsCase(actor, document.case);
  if (document.status === "archived") throw new DocumentServiceError("invalid_state", "Document is already archived");

  const result = await tx.document.updateMany({
    where: { id: documentId, version: expectedVersion },
    data: { status: "archived", archivedAt: new Date(), version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new DocumentServiceError("stale_version", "This Document changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.document.findUniqueOrThrow({ where: { id: documentId } });

  await writeAuditEvent(tx, {
    eventType: "document_archived",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: document.case.providerId,
    clientId: document.case.clientId,
    caseId: document.caseId,
    targetType: "Document",
    targetId: documentId,
    action: "archive",
    source: "api",
  });

  return updated;
}

export interface DeleteDocumentResult {
  hardDeleted: boolean;
}

/**
 * Hard-deletes only if zero non-creation activity exists (mirrors
 * deleteCaseService/deleteRuleService's eligibility check), which
 * structurally satisfies "not yet shared, validated, or audit-relevant"
 * (spec §24). document_type_confirmed is conservatively treated as
 * non-creation activity even though it can happen as part of the initial
 * upload — there's no reliable signal distinguishing "confirmed at upload"
 * from "confirmed later" from the audit log alone, so this errs toward
 * archiving rather than risking a wrongful hard-delete.
 */
export async function deleteDocumentService(
  tx: Prisma.TransactionClient,
  storage: StorageAdapter,
  actor: AuthContext,
  documentId: string
): Promise<DeleteDocumentResult> {
  const document = await tx.document.findUnique({
    where: { id: documentId },
    include: { case: true, versions: { include: { sourceFile: true } } },
  });
  if (!document) throw new DocumentServiceError("not_found", "Document not found");
  assertProviderUserOwnsCase(actor, document.case);

  const activityCount = await tx.auditEvent.count({
    where: { targetType: "Document", targetId: documentId, eventType: { notIn: ["document_created"] } },
  });
  const eligibleForHardDelete = activityCount === 0;

  if (eligibleForHardDelete) {
    const sourceFiles = document.versions.map((v) => v.sourceFile);
    const sourceFileIds = [...new Set(sourceFiles.map((sf) => sf.id))];

    await writeAuditEvent(tx, {
      eventType: "document_deleted",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: document.case.providerId,
      clientId: document.case.clientId,
      caseId: document.caseId,
      targetType: "Document",
      targetId: documentId,
      action: "hard_delete",
      source: "api",
    });

    const versionIds = document.versions.map((v) => v.id);

    await tx.document.update({ where: { id: documentId }, data: { currentVersionId: null } });
    await tx.documentPageReference.deleteMany({ where: { sourceFileId: { in: sourceFileIds } } });
    // Segment 6 processing artifacts have no cascade — clean up explicitly
    // before deleting their parent DocumentVersion rows, same pattern as
    // DocumentPageReference above.
    await tx.extractedField.deleteMany({ where: { documentVersionId: { in: versionIds } } });
    await tx.documentClassificationResult.deleteMany({ where: { documentVersionId: { in: versionIds } } });
    await tx.ocrPageResult.deleteMany({ where: { documentVersionId: { in: versionIds } } });
    await tx.documentProcessingJob.deleteMany({ where: { documentVersionId: { in: versionIds } } });
    await tx.documentVersion.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
    await tx.sourceFile.deleteMany({ where: { id: { in: sourceFileIds } } });

    for (const sf of sourceFiles) {
      await storage.delete(sf.storageKey);
    }

    await recalculateDocumentPhaseStatus(tx, actor, document.caseId);

    return { hardDeleted: true };
  }

  await archiveDocumentService(tx, actor, documentId, document.version);
  await recalculateDocumentPhaseStatus(tx, actor, document.caseId);
  return { hardDeleted: false };
}
