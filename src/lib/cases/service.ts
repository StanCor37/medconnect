import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
import { writeAuditEvent } from "@/lib/audit/record";
import { generateInternalReference } from "@/lib/cases/internalReference";
import { checkForDuplicateCase } from "@/lib/duplicate-detection/case";
import { checkIdempotencyKey } from "@/lib/cases/idempotency";
import type { CreateCaseInput, UpdateCaseInput } from "@/lib/validation/case";

export class CaseServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function caseErrorStatus(code: string): number {
  switch (code) {
    case "duplicate_external_reference":
      return 409;
    case "idempotency_key_conflict":
      return 409;
    case "stale_version":
      return 409;
    case "probable_duplicate_case":
      return 422;
    case "inactive_relationship":
      return 422;
    case "invalid_state":
      return 409;
    case "invalid_scheme_state":
      return 409;
    case "incompatible_scheme":
      return 422;
    case "invalid_input":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

type ExistingCase = {
  providerId: string;
  providerCaseAccess: "creator_only" | "provider_shared";
  createdByUserId: string;
};

/**
 * The ownership boundary for every mutating Case action: cross-Provider and
 * "creator_only, not the creator" both become "not_found" (404), never a
 * 403 — a colleague must never learn a creator_only Case exists, and a
 * Case at another Provider must never be confirmed to exist either.
 */
function assertProviderUserOwnsCase(actor: AuthContext, existing: ExistingCase) {
  if (actor.role !== "provider_user" || existing.providerId !== actor.providerId) {
    throw new CaseServiceError("not_found", "Case not found");
  }
  if (existing.providerCaseAccess === "creator_only" && existing.createdByUserId !== actor.userId) {
    throw new CaseServiceError("not_found", "Case not found");
  }
}

export interface CreateCaseResult {
  case: Prisma.CaseGetPayload<object>;
  replayed: boolean;
  duplicateWarning: { candidates: { caseId: string; internalReference: string }[] } | null;
}

export async function createCaseService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateCaseInput,
  idempotency?: { key: string; requestHash: string }
): Promise<CreateCaseResult> {
  if (actor.role !== "provider_user") {
    throw new CaseServiceError("forbidden", "Only Provider Users can create Cases");
  }

  if (idempotency) {
    const check = await checkIdempotencyKey(tx, actor.providerId!, idempotency.key, idempotency.requestHash);
    if (check.kind === "conflict") {
      throw new CaseServiceError(
        "idempotency_key_conflict",
        "This Idempotency-Key was already used with a different request body."
      );
    }
    if (check.kind === "replay") {
      const existing = await tx.case.findUnique({ where: { id: check.caseId } });
      if (existing) {
        return { case: existing, replayed: true, duplicateWarning: null };
      }
      // Referenced Case was hard-deleted since — stale key, drop it and fall through to a fresh create.
      await tx.idempotencyKey.delete({
        where: { providerId_key: { providerId: actor.providerId!, key: idempotency.key } },
      });
    }
  }

  let relationship: { id: string } | null = null;
  if (input.clientId) {
    const found = await tx.providerClientRelationship.findUnique({
      where: { providerId_clientId: { providerId: actor.providerId!, clientId: input.clientId } },
    });
    if (!found || found.status !== "active") {
      throw new CaseServiceError(
        "inactive_relationship",
        "Choose a Client you are actively connected with, or continue without sharing."
      );
    }
    relationship = found;
  }

  const duplicate = await checkForDuplicateCase(tx, {
    providerId: actor.providerId!,
    clientId: input.clientId ?? null,
    externalReferenceSource: input.externalReferenceSource ?? null,
    externalReference: input.externalReference ?? null,
    patientReference: input.patientReference ?? null,
    eventDate: input.eventDate ?? null,
    serviceType: input.serviceType ?? null,
  });
  if (duplicate.kind === "exact_match") {
    throw new CaseServiceError(
      "duplicate_external_reference",
      "A Case with this external reference already exists for this Provider/Client."
    );
  }
  if (duplicate.kind === "probable_match" && !input.confirmedNotDuplicateBy) {
    throw new CaseServiceError(
      "probable_duplicate_case",
      "A similar Case (same patient reference, date and type) already exists. Confirm this is not a duplicate to proceed."
    );
  }

  const internalReference = await generateInternalReference(tx);

  let created;
  try {
    created = await tx.case.create({
      data: {
        internalReference,
        caseMode: input.clientId ? "client_connected" : "standalone",
        source: "ui",
        status: "draft",
        providerId: actor.providerId!,
        createdByUserId: actor.userId,
        insurerId: input.insurerId ?? null,
        clientId: input.clientId ?? null,
        providerClientRelationshipId: relationship?.id ?? null,
        externalReference: input.externalReference ?? null,
        externalReferenceSource: input.externalReferenceSource ?? null,
        patientReference: input.patientReference ?? null,
        serviceType: input.serviceType ?? null,
        eventDate: input.eventDate ?? null,
      },
    });
  } catch (err) {
    // DB unique constraint is the backstop for the client-connected race the
    // app-layer duplicate check above can miss — never let the raw
    // constraint-violation error leak to the client.
    if (isUniqueConstraintError(err, "Case_providerId_clientId_externalReferenceSource_externalRe")) {
      throw new CaseServiceError(
        "duplicate_external_reference",
        "A Case with this external reference already exists for this Provider/Client."
      );
    }
    throw err;
  }

  if (idempotency) {
    await tx.idempotencyKey.create({
      data: {
        providerId: actor.providerId!,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        caseId: created.id,
      },
    });
  }

  await writeAuditEvent(tx, {
    eventType: "case_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: created.providerId,
    clientId: created.clientId,
    relationshipId: created.providerClientRelationshipId,
    caseId: created.id,
    targetType: "Case",
    targetId: created.id,
    action: "create",
    source: "api",
  });

  if (input.insurerId) {
    await writeAuditEvent(tx, {
      eventType: "case_insurer_recognized",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: created.providerId,
      clientId: created.clientId,
      caseId: created.id,
      targetType: "Case",
      targetId: created.id,
      action: "recognize_insurer",
      source: "api",
    });
  }

  if (duplicate.kind === "probable_match") {
    await writeAuditEvent(tx, {
      eventType: "case_duplicate_warning_overridden",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: created.providerId,
      clientId: created.clientId,
      caseId: created.id,
      targetType: "Case",
      targetId: created.id,
      action: "confirm_not_duplicate",
      source: "api",
    });
  }

  return {
    case: created,
    replayed: false,
    duplicateWarning: duplicate.kind === "probable_match" ? duplicate : null,
  };
}

function isUniqueConstraintError(err: unknown, constraintNameFragment: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002" &&
    JSON.stringify((err as { meta?: unknown }).meta ?? "").includes(constraintNameFragment)
  );
}

export async function updateCaseService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  input: UpdateCaseInput
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);
  if (existing.status !== "draft") {
    throw new CaseServiceError("invalid_state", "Only draft Cases can be edited this phase");
  }

  if (input.externalReference !== undefined || input.externalReferenceSource !== undefined) {
    const duplicate = await checkForDuplicateCase(
      tx,
      {
        providerId: existing.providerId,
        clientId: existing.clientId,
        externalReferenceSource: input.externalReferenceSource ?? existing.externalReferenceSource,
        externalReference: input.externalReference ?? existing.externalReference,
        patientReference: existing.patientReference,
        eventDate: existing.eventDate,
        serviceType: existing.serviceType,
      },
      caseId
    );
    if (duplicate.kind === "exact_match") {
      throw new CaseServiceError("duplicate_external_reference", "A Case with this external reference already exists.");
    }
  }

  const { version, ...data } = input;
  const changedFields = Object.keys(data);
  const result = await tx.case.updateMany({
    where: { id: caseId, version },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new CaseServiceError(
      "stale_version",
      "This Case changed before your action was completed. Reload it and try again."
    );
  }

  const updated = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
  await writeAuditEvent(tx, {
    eventType: "case_updated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "update",
    source: "api",
    // Field names only — never values (Segment 11: never log patient/medical data).
    reasonCode: changedFields.length > 0 ? `fields:${changedFields.join(",")}` : null,
  });
  return updated;
}

export async function shareWithClientService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  targetClientId: string,
  expectedVersion: number
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);
  if (existing.caseMode !== "standalone") {
    throw new CaseServiceError("invalid_state", "Only a standalone Case can be shared");
  }

  const relationship = await tx.providerClientRelationship.findUnique({
    where: { providerId_clientId: { providerId: actor.providerId!, clientId: targetClientId } },
  });
  if (!relationship || relationship.status !== "active") {
    throw new CaseServiceError(
      "inactive_relationship",
      "Choose a Client you are actively connected with, or continue without sharing."
    );
  }

  const result = await tx.case.updateMany({
    where: { id: caseId, version: expectedVersion },
    data: {
      caseMode: "client_connected",
      clientId: targetClientId,
      providerClientRelationshipId: relationship.id,
      version: { increment: 1 },
    },
  });
  if (result.count === 0) {
    throw new CaseServiceError(
      "stale_version",
      "This Case changed before your action was completed. Reload it and try again."
    );
  }

  const updated = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
  await writeAuditEvent(tx, {
    eventType: "case_shared_with_client",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    relationshipId: relationship.id,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "share_with_client",
    source: "api",
  });
  return updated;
}

export async function assignCaseService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  targetUserId: string,
  expectedVersion: number
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);

  const targetUser = await tx.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser || targetUser.providerId !== existing.providerId) {
    // Must never move a Case to another Provider.
    throw new CaseServiceError("invalid_input", "Assignee must be a User within the same Provider");
  }

  const result = await tx.case.updateMany({
    where: { id: caseId, version: expectedVersion },
    data: { assignedToUserId: targetUserId, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new CaseServiceError(
      "stale_version",
      "This Case changed before your action was completed. Reload it and try again."
    );
  }

  const updated = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
  await writeAuditEvent(tx, {
    eventType: "case_assigned",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "assign",
    source: "api",
  });
  return updated;
}

export async function archiveCaseService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  expectedVersion: number
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);
  if (existing.status === "archived") {
    throw new CaseServiceError("invalid_state", "Case is already archived");
  }

  const result = await tx.case.updateMany({
    where: { id: caseId, version: expectedVersion },
    data: { status: "archived", archivedAt: new Date(), version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new CaseServiceError(
      "stale_version",
      "This Case changed before your action was completed. Reload it and try again."
    );
  }

  const updated = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
  await writeAuditEvent(tx, {
    eventType: "case_archived",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "archive",
    source: "api",
  });
  return updated;
}

export async function restoreCaseService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  expectedVersion: number
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);
  if (existing.status !== "archived") {
    throw new CaseServiceError("invalid_state", "Case is not archived");
  }

  const result = await tx.case.updateMany({
    where: { id: caseId, version: expectedVersion },
    data: { status: "draft", archivedAt: null, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new CaseServiceError(
      "stale_version",
      "This Case changed before your action was completed. Reload it and try again."
    );
  }

  const updated = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
  await writeAuditEvent(tx, {
    eventType: "case_restored",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "restore",
    source: "api",
  });
  return updated;
}

export interface DeleteCaseResult {
  hardDeleted: boolean;
}

/**
 * Hard-deletes only a zero-activity standalone draft (mirrors
 * deleteAccountService's eligibility check exactly). Otherwise falls back
 * to archival.
 */
export async function deleteCaseService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string
): Promise<DeleteCaseResult> {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);

  const activityCount = await tx.auditEvent.count({
    where: {
      targetType: "Case",
      targetId: existing.id,
      eventType: { notIn: ["case_created", "case_insurer_recognized"] },
    },
  });
  const eligibleForHardDelete =
    existing.caseMode === "standalone" && existing.status === "draft" && activityCount === 0;

  if (eligibleForHardDelete) {
    await tx.idempotencyKey.deleteMany({ where: { caseId: existing.id } });
    await writeAuditEvent(tx, {
      eventType: "case_deleted",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: existing.providerId,
      clientId: existing.clientId,
      caseId: existing.id,
      targetType: "Case",
      targetId: existing.id,
      action: "hard_delete",
      source: "api",
    });
    // AuditEvent.caseId nulls via onDelete: SetNull; targetId keeps the durable pointer.
    await tx.case.delete({ where: { id: existing.id } });
    return { hardDeleted: true };
  }

  await archiveCaseService(tx, actor, caseId, existing.version);
  return { hardDeleted: false };
}

/**
 * Assigns/changes a Case's pinned Validation Scheme version — the
 * connection point Segment 4 deferred until Segment 3 existed. Re-validates
 * compatibility explicitly rather than relying on scopedSchemeWhere, since
 * the invariant "a global Scheme contains only global Rules" should already
 * be guaranteed by addRuleToSchemeService but is never trusted blindly here.
 */
export async function assignSchemeVersionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  schemeVersionId: string,
  expectedVersion: number
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);

  const schemeVersion = await tx.validationSchemeVersion.findUnique({
    where: { id: schemeVersionId },
    include: { scheme: true, schemeRules: { include: { ruleVersion: { include: { rule: true } } } } },
  });
  if (!schemeVersion) throw new CaseServiceError("not_found", "Validation Scheme version not found");
  if (schemeVersion.publishedAt === null || schemeVersion.scheme.status !== "published") {
    throw new CaseServiceError("invalid_scheme_state", "Only a published Validation Scheme can be assigned to a Case");
  }

  if (existing.caseMode === "standalone") {
    const allGlobal =
      schemeVersion.scheme.scope === "global" &&
      schemeVersion.schemeRules.every((sr) => sr.ruleVersion.rule.scope === "global");
    if (!allGlobal) {
      throw new CaseServiceError(
        "incompatible_scheme",
        "A standalone Case can only use a fully-global published Validation Scheme"
      );
    }
  } else {
    const compatible = schemeVersion.scheme.scope === "global" || schemeVersion.scheme.clientId === existing.clientId;
    if (!compatible) {
      throw new CaseServiceError(
        "incompatible_scheme",
        "Choose a global Validation Scheme or one owned by this Case's Client"
      );
    }
  }

  const result = await tx.case.updateMany({
    where: { id: caseId, version: expectedVersion },
    data: { validationSchemeVersionId: schemeVersionId, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new CaseServiceError(
      "stale_version",
      "This Case changed before your action was completed. Reload it and try again."
    );
  }

  const updated = await tx.case.findUniqueOrThrow({ where: { id: caseId } });

  await writeAuditEvent(tx, {
    eventType: existing.validationSchemeVersionId === null ? "case_scheme_assigned" : "case_scheme_changed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "assign_scheme",
    source: "api",
  });

  return updated;
}
