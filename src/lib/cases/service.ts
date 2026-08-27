import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
import { writeAuditEvent } from "@/lib/audit/record";
import { generateInternalReference } from "@/lib/cases/internalReference";
import { checkForDuplicateCase } from "@/lib/duplicate-detection/case";
import { checkIdempotencyKey } from "@/lib/cases/idempotency";
import { transitionCaseStatus } from "@/lib/cases/stateMachine";
import type { CreateCaseInput, UpdateCaseInput } from "@/lib/validation/case";
import type {
  SubmitCaseInput,
  ReturnCaseInput,
  AcceptCaseInput,
  RejectCaseInput,
  MarkLiquidatedInput,
  CloseCaseInput,
  CancelCaseInput,
  ReopenCaseInput,
} from "@/lib/validation/caseLifecycle";

export { CaseServiceError, caseErrorStatus } from "@/lib/cases/errors";
import { CaseServiceError } from "@/lib/cases/errors";

type ExistingCase = {
  providerId: string;
  providerCaseAccess: "creator_only" | "provider_shared";
  createdByUserId: string;
};

type ExistingCaseForClient = {
  clientId: string | null;
  providerClientRelationshipId: string | null;
};

/**
 * Client Admin's ownership boundary — the first-ever Case-mutation
 * authority Client Admin has in this codebase (Segment 8). Re-checks the
 * relationship is ACTIVE at the moment of the action, not just that it
 * exists, mirroring scopedHitlTaskWhere's re-check-at-every-access pattern
 * from Segment 7 rather than trusting a point-in-time association.
 */
async function assertClientAdminOwnsCase(tx: Prisma.TransactionClient, actor: AuthContext, existing: ExistingCaseForClient) {
  if (actor.role !== "client_admin" || existing.clientId !== actor.clientId) {
    throw new CaseServiceError("not_found", "Case not found");
  }
  const relationship = existing.providerClientRelationshipId
    ? await tx.providerClientRelationship.findUnique({ where: { id: existing.providerClientRelationshipId } })
    : null;
  if (relationship?.status !== "active") {
    throw new CaseServiceError("not_found", "Case not found");
  }
}

/**
 * Shared by close/cancel/reopen, the three actions spec §7/§8 grants to
 * EITHER side depending on who currently has standing mutation rights over
 * the Case — resolves which one actually applies rather than the route
 * layer guessing, and returns the TransitionActorType for the resulting
 * CaseStatusHistory row.
 */
async function assertLifecycleActionActor(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  existing: ExistingCase & ExistingCaseForClient
): Promise<"provider" | "client"> {
  if (actor.role === "provider_user") {
    assertProviderUserOwnsCase(actor, existing);
    return "provider";
  }
  if (actor.role === "client_admin") {
    await assertClientAdminOwnsCase(tx, actor, existing);
    return "client";
  }
  throw new CaseServiceError("not_found", "Case not found");
}

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
  // spec §11's status-recalculation table maps every currently-reachable
  // standalone status to itself (draft/documents_in_progress/
  // ready_for_validation/validated/validated_with_issues) — sharing never
  // changes status on its own. `closed` is explicitly blocked ("reopen
  // before sharing"); cancelled/archived are blocked for the same reason
  // (extending the spec's own intent to the two terminal statuses its table
  // doesn't enumerate).
  if (existing.status === "closed" || existing.status === "cancelled" || existing.status === "archived") {
    throw new CaseServiceError("invalid_state", "Reopen this Case before sharing it with a Client");
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

/**
 * Deliberately permissive — legal from ANY current status, not just
 * terminal ones (see stateMachine.ts's CASE_TRANSITIONS comment): this is
 * what deleteCaseService's soft-delete fallback below relies on. Records
 * statusBeforeArchive (via transitionCaseStatus) so restoreCaseService can
 * put the Case back where it actually was.
 */
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

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "archived",
    expectedVersion,
    actorType: "provider",
    source: "provider_ui",
  });

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

/** Restores to statusBeforeArchive (falling back to "draft" for pre-Segment-8 rows that never recorded one). */
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

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: existing.statusBeforeArchive ?? "draft",
    expectedVersion,
    actorType: "provider",
    source: "provider_ui",
    allowReopen: true, // restore is its own controlled path back from "archived", which CASE_TRANSITIONS deliberately excludes as a normal source status
  });

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

/**
 * spec §4 "Submitted to Client": Provider-only, active relationship, Client
 * association, pinned Scheme, a COMPLETED current validation, and explicit
 * confirmation (the Zod-enforced `confirm: true` literal). Creates the
 * immutable CaseSubmission snapshot — later Case/Document changes never
 * update it (spec §14); a genuinely new package requires calling this again,
 * which creates a brand-new CaseSubmission row, never editing the old one.
 */
export async function submitCaseService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: SubmitCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  assertProviderUserOwnsCase(actor, existing);

  if (existing.caseMode !== "client_connected" || !existing.clientId) {
    throw new CaseServiceError("invalid_state", "Only a Client-connected Case can be submitted");
  }
  const relationship = existing.providerClientRelationshipId
    ? await tx.providerClientRelationship.findUnique({ where: { id: existing.providerClientRelationshipId } })
    : null;
  if (relationship?.status !== "active") {
    throw new CaseServiceError("inactive_relationship", "Your relationship with this Client is not active");
  }
  if (!existing.validationSchemeVersionId) {
    throw new CaseServiceError("invalid_state", "Assign a Validation Scheme before submitting");
  }
  const latestRun = await tx.validationRun.findFirst({ where: { caseId }, orderBy: { runNumber: "desc" } });
  if (!latestRun || (latestRun.status !== "completed" && latestRun.status !== "partially_completed")) {
    throw new CaseServiceError("invalid_state", "Validate this Case before submitting it");
  }

  const documents = await tx.document.findMany({ where: { caseId, archivedAt: null, currentVersionId: { not: null } } });

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "submitted_to_client",
    expectedVersion: input.version,
    actorType: "provider",
    source: "provider_ui",
  });

  await tx.caseSubmission.create({
    data: {
      caseId,
      clientId: existing.clientId,
      validationRunId: latestRun.id,
      documentVersionIds: documents.map((d) => d.currentVersionId!),
      submittedByUserId: actor.userId,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "case_submitted",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "submit",
    source: "api",
  });

  return updated;
}

/** spec §4 "Returned to Provider" — Client Admin only. */
export async function returnCaseToProviderService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: ReturnCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  await assertClientAdminOwnsCase(tx, actor, existing);
  if (existing.status !== "submitted_to_client" && existing.status !== "client_review_required") {
    throw new CaseServiceError("invalid_transition", "This Case is not awaiting Client action");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "returned_to_provider",
    expectedVersion: input.version,
    actorType: "client",
    source: "client_ui",
    reasonCode: input.returnReason,
    reason: input.reason,
  });

  await writeAuditEvent(tx, {
    eventType: "case_returned",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "return_to_provider",
    source: "api",
    reasonCode: input.returnReason,
  });

  return updated;
}

/** spec §4 "Accepted" — Client Admin (or Client API, unused this phase) only, never Provider. */
export async function acceptCaseService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: AcceptCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  await assertClientAdminOwnsCase(tx, actor, existing);
  if (existing.status !== "submitted_to_client") {
    throw new CaseServiceError("invalid_transition", "Only a submitted Case can be accepted");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "accepted",
    expectedVersion: input.version,
    actorType: "client",
    source: "client_ui",
  });
  await tx.case.update({
    where: { id: caseId },
    data: { acceptedByUserId: actor.userId, acceptedAt: new Date(), acceptanceSource: "client_admin" },
  });

  await writeAuditEvent(tx, {
    eventType: "case_accepted",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "accept",
    source: "api",
  });

  return tx.case.findUniqueOrThrow({ where: { id: caseId } });
}

/**
 * spec §4 "Rejected" — Client Admin only, never automated (spec §10's own
 * required test: "never automatically reject solely because AI fails or
 * confidence is low" — this is the ONLY function that ever sets "rejected";
 * startValidationRunService's mapping table has no path to it).
 */
export async function rejectCaseService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: RejectCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  await assertClientAdminOwnsCase(tx, actor, existing);
  if (existing.status !== "submitted_to_client" && existing.status !== "client_review_required") {
    throw new CaseServiceError("invalid_transition", "Only a submitted Case can be rejected");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "rejected",
    expectedVersion: input.version,
    actorType: "client",
    source: "client_ui",
    reasonCode: input.rejectionReason,
    reason: input.rejectionNote,
  });
  await tx.case.update({
    where: { id: caseId },
    data: {
      rejectedByUserId: actor.userId,
      rejectedAt: new Date(),
      rejectionReason: input.rejectionReason,
      rejectionNote: input.rejectionNote,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "case_rejected",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "reject",
    source: "api",
    reasonCode: input.rejectionReason,
  });

  return tx.case.findUniqueOrThrow({ where: { id: caseId } });
}

/** spec §4 "Liquidated" — Client Admin only; MedConnect never executes the payment itself, only records that it happened externally. */
export async function markLiquidatedService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: MarkLiquidatedInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  await assertClientAdminOwnsCase(tx, actor, existing);
  if (existing.status !== "accepted") {
    throw new CaseServiceError("invalid_transition", "Only an accepted Case can be marked liquidated");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "liquidated",
    expectedVersion: input.version,
    actorType: "client",
    source: "client_ui",
  });
  await tx.case.update({
    where: { id: caseId },
    data: {
      liquidatedByUserId: actor.userId,
      liquidatedAt: new Date(),
      liquidationSource: input.liquidationSource ?? null,
      externalLiquidationReference: input.externalLiquidationReference ?? null,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "case_liquidated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "mark_liquidated",
    source: "api",
  });

  return tx.case.findUniqueOrThrow({ where: { id: caseId } });
}

/** spec §4 "Closed" — Provider (standalone) or authorized Client (connected). */
export async function closeCaseService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: CloseCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  const actorType = await assertLifecycleActionActor(tx, actor, existing);
  if (existing.status !== "validated" && existing.status !== "validated_with_issues") {
    throw new CaseServiceError("invalid_transition", "Only a validated Case can be closed");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "closed",
    expectedVersion: input.version,
    actorType,
    source: actorType === "provider" ? "provider_ui" : "client_ui",
  });

  await writeAuditEvent(tx, {
    eventType: "case_closed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "close",
    source: "api",
  });

  return updated;
}

/** spec §4 "Cancelled" — Provider or Client, whoever currently has standing mutation rights; requires a reason, preserves all data/history. */
export async function cancelCaseService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: CancelCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  const actorType = await assertLifecycleActionActor(tx, actor, existing);
  const cancellableFrom: string[] = ["draft", "documents_in_progress", "ready_for_validation", "provider_action_required"];
  if (!cancellableFrom.includes(existing.status)) {
    throw new CaseServiceError("invalid_transition", "This Case can no longer be cancelled");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "cancelled",
    expectedVersion: input.version,
    actorType,
    source: actorType === "provider" ? "provider_ui" : "client_ui",
    reasonCode: input.cancellationReason,
    reason: input.cancellationNote,
  });
  await tx.case.update({
    where: { id: caseId },
    data: {
      cancelledByUserId: actor.userId,
      cancelledAt: new Date(),
      cancellationReason: input.cancellationReason,
      cancellationNote: input.cancellationNote ?? null,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "case_cancelled",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "cancel",
    source: "api",
    reasonCode: input.cancellationReason,
  });

  return tx.case.findUniqueOrThrow({ where: { id: caseId } });
}

/**
 * spec §12 "Reopening" — controlled, reason-required, audited. Never from
 * `liquidated` (spec's own carve-out — "use a separately defined controlled
 * adjustment process"), enforced both by the allowed-source list here AND
 * defensively inside transitionCaseStatus itself. A Provider may reopen a
 * Case they own from closed/cancelled; a Client Admin may additionally
 * reopen one they rejected — a Provider can never reopen a rejected Case,
 * that decision belongs to the Client that made it.
 */
export async function reopenCaseService(tx: Prisma.TransactionClient, actor: AuthContext, caseId: string, input: ReopenCaseInput) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");
  const actorType = await assertLifecycleActionActor(tx, actor, existing);

  const allowedSource = actorType === "provider" ? ["closed", "cancelled"] : ["closed", "cancelled", "rejected"];
  if (!allowedSource.includes(existing.status)) {
    throw new CaseServiceError("invalid_transition", "This Case cannot be reopened from its current status");
  }

  const updated = await transitionCaseStatus(tx, actor, caseId, {
    toStatus: "draft",
    expectedVersion: input.version,
    actorType,
    source: actorType === "provider" ? "provider_ui" : "client_ui",
    reason: input.reason,
    allowReopen: true,
  });

  await writeAuditEvent(tx, {
    eventType: "case_reopened",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: updated.providerId,
    clientId: updated.clientId,
    caseId: updated.id,
    targetType: "Case",
    targetId: updated.id,
    action: "reopen",
    source: "api",
  });

  return updated;
}
