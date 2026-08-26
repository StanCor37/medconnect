import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
import { writeAuditEvent } from "@/lib/audit/record";
import type { CreateSchemeInput, AddSchemeRuleInput, UpdateSchemeRuleInput } from "@/lib/validation/scheme";
import type { AddDocumentTypeInput, UpdateDocumentTypeInput } from "@/lib/validation/document";

export class SchemeServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function schemeErrorStatus(code: string): number {
  switch (code) {
    case "stale_version":
      return 409;
    case "invalid_state":
      return 409;
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

export async function createDraftSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateSchemeInput
) {
  if (actor.role !== "super_admin" && actor.role !== "client_admin") {
    throw new SchemeServiceError("forbidden", "Only Super Admin or Client Admin can create Validation Schemes");
  }
  const scope = actor.role === "super_admin" ? "global" : "client";
  const clientId = actor.role === "client_admin" ? actor.clientId! : null;

  const scheme = await tx.validationScheme.create({
    data: {
      scope,
      clientId,
      name: input.name,
      description: input.description ?? null,
      insurerId: input.insurerId ?? null,
      productLine: input.productLine ?? null,
      productId: input.productId ?? null,
      countryCodes: input.countryCodes,
      status: "draft",
      createdByUserId: actor.userId,
    },
  });

  const version = await tx.validationSchemeVersion.create({
    data: { schemeId: scheme.id, versionNumber: 1 },
  });

  const updated = await tx.validationScheme.update({
    where: { id: scheme.id },
    data: { currentVersionId: version.id },
    include: { currentVersion: true },
  });

  await writeAuditEvent(tx, {
    eventType: "scheme_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId,
    targetType: "ValidationScheme",
    targetId: scheme.id,
    action: "create",
    source: "api",
  });

  return updated;
}

/**
 * The critical cross-tenant-leak guard: a scope:"client" scheme may add a
 * rule iff it's global or owned by the SAME clientId; a scope:"global"
 * scheme may ONLY ever add global rules. Checked here at add-time, and
 * re-checked defensively at Case-assignment time (assignSchemeVersionService)
 * — never trust this invariant blindly at read time.
 *
 * `schemeVersionId` is caller-supplied (not derived from
 * scheme.currentVersionId) so this works against ANY of the Scheme's own
 * unpublished draft versions — including one created by
 * createNextDraftSchemeVersionService, which deliberately does not move
 * currentVersionId until publish. The `version.schemeId !== schemeId` check
 * is what stops a versionId belonging to a different Scheme from being used.
 */
export async function addRuleToSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  schemeVersionId: string,
  expectedSchemeVersion: number,
  input: Omit<AddSchemeRuleInput, "schemeVersionId">
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({ where: { id: schemeVersionId } });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) {
    throw new SchemeServiceError("invalid_state", "Rules can only be added to an unpublished draft version");
  }

  const ruleVersion = await tx.validationRuleVersion.findUnique({
    where: { id: input.ruleVersionId },
    include: { rule: true },
  });
  if (!ruleVersion) throw new SchemeServiceError("not_found", "Rule version not found");
  if (ruleVersion.publishedAt === null) {
    throw new SchemeServiceError("invalid_state", "Only a published Rule version can be added to a Scheme");
  }

  if (scheme.scope === "global" && ruleVersion.rule.scope !== "global") {
    throw new SchemeServiceError("invalid_input", "A global Scheme can only contain global Rules");
  }
  if (scheme.scope === "client") {
    const ruleAllowed = ruleVersion.rule.scope === "global" || ruleVersion.rule.clientId === scheme.clientId;
    if (!ruleAllowed) {
      throw new SchemeServiceError("invalid_input", "A Client Scheme may only contain global Rules or Rules owned by that same Client");
    }
  }

  await tx.validationSchemeRule.create({
    data: {
      schemeVersionId,
      ruleVersionId: input.ruleVersionId,
      executionOrder: input.executionOrder,
      parameters: input.parameters as Prisma.InputJsonValue,
      enabled: input.enabled,
      required: input.required,
      hitlPolicyOverride: input.hitlPolicyOverride ?? null,
    },
  });

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const updatedScheme = await tx.validationScheme.findUniqueOrThrow({ where: { id: schemeId } });
  const editedVersion = await tx.validationSchemeVersion.findUniqueOrThrow({
    where: { id: schemeVersionId },
    include: { schemeRules: true },
  });

  await writeAuditEvent(tx, {
    eventType: "scheme_rule_added",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "add_rule",
    source: "api",
  });

  return { ...updatedScheme, currentVersion: editedVersion };
}

export async function updateSchemeRuleService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  schemeVersionId: string,
  expectedSchemeVersion: number,
  schemeRuleId: string,
  patch: Omit<UpdateSchemeRuleInput, "schemeVersionId">
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({ where: { id: schemeVersionId } });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) {
    throw new SchemeServiceError("invalid_state", "Only an unpublished draft version can be edited");
  }

  // Strip schemeVersionId defensively even though patch's declared type
  // already omits it — a caller passing the full parsed request body
  // (which DOES carry schemeVersionId, needed for the positional argument
  // above) must never let it leak through into the Prisma update payload
  // and silently move this pairing to a different scheme version.
  const { version: _version, ...rest } = patch as UpdateSchemeRuleInput;
  const { schemeVersionId: _schemeVersionId, ...data } = rest;
  void _version;
  void _schemeVersionId;
  const result = await tx.validationSchemeRule.updateMany({
    where: { id: schemeRuleId, schemeVersionId },
    data: data as Prisma.ValidationSchemeRuleUpdateManyMutationInput,
  });
  if (result.count === 0) throw new SchemeServiceError("not_found", "Scheme rule pairing not found on this draft version");

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.validationSchemeRule.findUniqueOrThrow({ where: { id: schemeRuleId } });

  await writeAuditEvent(tx, {
    eventType: "scheme_rule_updated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "update_rule",
    source: "api",
  });

  return updated;
}

export async function removeRuleFromSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  schemeVersionId: string,
  expectedSchemeVersion: number,
  schemeRuleId: string
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({ where: { id: schemeVersionId } });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) {
    throw new SchemeServiceError("invalid_state", "Only an unpublished draft version can be edited");
  }

  const result = await tx.validationSchemeRule.deleteMany({
    where: { id: schemeRuleId, schemeVersionId },
  });
  if (result.count === 0) throw new SchemeServiceError("not_found", "Scheme rule pairing not found on this draft version");

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  await writeAuditEvent(tx, {
    eventType: "scheme_rule_removed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "remove_rule",
    source: "api",
  });

  return tx.validationScheme.findUniqueOrThrow({ where: { id: schemeId } });
}

/**
 * Document Type CRUD (Segment 5 spec §3) — identical shape to
 * addRuleToSchemeService/updateSchemeRuleService/removeRuleFromSchemeService:
 * legal against any of the Scheme's own unpublished draft versions (caller
 * supplies schemeVersionId explicitly — never derived from
 * scheme.currentVersionId, which would make a version created by
 * createNextDraftSchemeVersionService unreachable until it's already
 * published), optimistic-concurrency bump on the parent Scheme. Built now,
 * in Segment 3's own domain, because Document upload has a hard dependency
 * on it — same justification as Segment 3 extending Case with
 * assignSchemeVersionService.
 */
export async function addDocumentTypeToSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  schemeVersionId: string,
  expectedSchemeVersion: number,
  input: Omit<AddDocumentTypeInput, "schemeVersionId">
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({ where: { id: schemeVersionId } });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) {
    throw new SchemeServiceError("invalid_state", "Document Types can only be added to an unpublished draft version");
  }

  await tx.documentTypeDefinition.create({
    data: {
      schemeVersionId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      acceptedMimeTypes: input.acceptedMimeTypes,
      required: input.required,
      multipleAllowed: input.multipleAllowed,
      expectedFields: input.expectedFields as Prisma.InputJsonValue,
      classificationHints: input.classificationHints as Prisma.InputJsonValue,
      captureGuidance: input.captureGuidance ?? null,
      displayOrder: input.displayOrder,
    },
  });

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const updatedScheme = await tx.validationScheme.findUniqueOrThrow({ where: { id: schemeId } });
  const editedVersion = await tx.validationSchemeVersion.findUniqueOrThrow({
    where: { id: schemeVersionId },
    include: { documentTypeDefinitions: true },
  });

  await writeAuditEvent(tx, {
    eventType: "scheme_document_type_added",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "add_document_type",
    source: "api",
  });

  return { ...updatedScheme, currentVersion: editedVersion };
}

export async function updateDocumentTypeDefinitionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  schemeVersionId: string,
  expectedSchemeVersion: number,
  documentTypeId: string,
  patch: Omit<UpdateDocumentTypeInput, "schemeVersionId">
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({ where: { id: schemeVersionId } });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) {
    throw new SchemeServiceError("invalid_state", "Only an unpublished draft version can be edited");
  }

  // Strip schemeVersionId defensively even though patch's declared type
  // already omits it — see updateSchemeRuleService's identical comment.
  const { version: _version, ...rest } = patch as UpdateDocumentTypeInput;
  const { schemeVersionId: _schemeVersionId, ...data } = rest;
  void _version;
  void _schemeVersionId;
  const result = await tx.documentTypeDefinition.updateMany({
    where: { id: documentTypeId, schemeVersionId },
    data: data as Prisma.DocumentTypeDefinitionUpdateManyMutationInput,
  });
  if (result.count === 0) throw new SchemeServiceError("not_found", "Document Type not found on this draft version");

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.documentTypeDefinition.findUniqueOrThrow({ where: { id: documentTypeId } });

  await writeAuditEvent(tx, {
    eventType: "scheme_document_type_updated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "update_document_type",
    source: "api",
  });

  return updated;
}

export async function removeDocumentTypeFromSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  schemeVersionId: string,
  expectedSchemeVersion: number,
  documentTypeId: string
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({ where: { id: schemeVersionId } });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) {
    throw new SchemeServiceError("invalid_state", "Only an unpublished draft version can be edited");
  }

  const result = await tx.documentTypeDefinition.deleteMany({
    where: { id: documentTypeId, schemeVersionId },
  });
  if (result.count === 0) throw new SchemeServiceError("not_found", "Document Type not found on this draft version");

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  await writeAuditEvent(tx, {
    eventType: "scheme_document_type_removed",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "remove_document_type",
    source: "api",
  });

  return tx.validationScheme.findUniqueOrThrow({ where: { id: schemeId } });
}

/**
 * Deep-copies every ValidationSchemeRule pairing from the current version
 * into a new one. Composing this with removeRuleFromSchemeService +
 * addRuleToSchemeService on the new draft is how the optional "migrate to a
 * promoted global rule" flow (spec §10) is satisfied without a bespoke
 * endpoint.
 */
export async function createNextDraftSchemeVersionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  expectedSchemeVersion: number
) {
  const scheme = await tx.validationScheme.findUnique({
    where: { id: schemeId },
    include: { currentVersion: { include: { schemeRules: true, documentTypeDefinitions: true } } },
  });
  if (!scheme || !scheme.currentVersion) throw new SchemeServiceError("not_found", "Scheme not found");
  if (scheme.status !== "published") {
    throw new SchemeServiceError("invalid_state", "Only a published Scheme can start a new draft version");
  }

  const bump = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const current = scheme.currentVersion;
  const nextVersion = await tx.validationSchemeVersion.create({
    data: { schemeId, versionNumber: current.versionNumber + 1 },
  });

  if (current.schemeRules.length > 0) {
    await tx.validationSchemeRule.createMany({
      data: current.schemeRules.map((r) => ({
        schemeVersionId: nextVersion.id,
        ruleVersionId: r.ruleVersionId,
        executionOrder: r.executionOrder,
        parameters: r.parameters as Prisma.InputJsonValue,
        enabled: r.enabled,
        required: r.required,
        hitlPolicyOverride: r.hitlPolicyOverride,
      })),
    });
  }

  // "A Scheme version retains the exact Document Type definitions used for
  // historical validation" (Segment 5 spec §3) — deep-copied here the same
  // way schemeRules are, so configuration changes only ever apply to new
  // draft versions.
  if (current.documentTypeDefinitions.length > 0) {
    await tx.documentTypeDefinition.createMany({
      data: current.documentTypeDefinitions.map((d) => ({
        schemeVersionId: nextVersion.id,
        code: d.code,
        name: d.name,
        description: d.description,
        acceptedMimeTypes: d.acceptedMimeTypes,
        required: d.required,
        multipleAllowed: d.multipleAllowed,
        expectedFields: d.expectedFields as Prisma.InputJsonValue,
        classificationHints: d.classificationHints as Prisma.InputJsonValue,
        captureGuidance: d.captureGuidance,
        displayOrder: d.displayOrder,
        active: d.active,
      })),
    });
  }

  return nextVersion;
}

/** Requires at least one enabled pairing before allowing publish — a basic sanity check beyond the spec's literal text. */
export async function publishSchemeVersionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  versionId: string,
  expectedSchemeVersion: number
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  const version = await tx.validationSchemeVersion.findUnique({
    where: { id: versionId },
    include: { schemeRules: true },
  });
  if (!version || version.schemeId !== schemeId) throw new SchemeServiceError("not_found", "Scheme version not found");
  if (version.publishedAt !== null) throw new SchemeServiceError("invalid_state", "This version is already published");
  if (!version.schemeRules.some((r) => r.enabled)) {
    throw new SchemeServiceError("invalid_state", "A Scheme version needs at least one enabled Rule to publish");
  }

  await tx.validationSchemeVersion.update({
    where: { id: versionId },
    data: { publishedAt: new Date(), publishedByUserId: actor.userId },
  });

  const result = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { currentVersionId: versionId, status: "published", version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.validationScheme.findUniqueOrThrow({ where: { id: schemeId }, include: { currentVersion: true } });

  await writeAuditEvent(tx, {
    eventType: "scheme_published",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "publish",
    source: "api",
  });

  return updated;
}

export async function archiveSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string,
  expectedSchemeVersion: number
) {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");
  if (scheme.status === "archived") throw new SchemeServiceError("invalid_state", "Scheme is already archived");

  const result = await tx.validationScheme.updateMany({
    where: { id: schemeId, version: expectedSchemeVersion },
    data: { status: "archived", archivedAt: new Date(), version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new SchemeServiceError("stale_version", "This Scheme changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.validationScheme.findUniqueOrThrow({ where: { id: schemeId } });

  await writeAuditEvent(tx, {
    eventType: "scheme_archived",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: scheme.clientId,
    targetType: "ValidationScheme",
    targetId: schemeId,
    action: "archive",
    source: "api",
  });

  return updated;
}

export interface DeleteSchemeResult {
  hardDeleted: boolean;
}

export async function deleteSchemeService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  schemeId: string
): Promise<DeleteSchemeResult> {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw new SchemeServiceError("not_found", "Scheme not found");

  const publishedVersionCount = await tx.validationSchemeVersion.count({
    where: { schemeId, publishedAt: { not: null } },
  });
  const caseReferenceCount = await tx.case.count({
    where: { validationSchemeVersion: { schemeId } },
  });
  const eligibleForHardDelete = publishedVersionCount === 0 && caseReferenceCount === 0;

  if (eligibleForHardDelete) {
    await tx.validationScheme.update({ where: { id: schemeId }, data: { currentVersionId: null } });
    const versionIds = (await tx.validationSchemeVersion.findMany({ where: { schemeId }, select: { id: true } })).map(
      (v) => v.id
    );
    await tx.validationSchemeRule.deleteMany({ where: { schemeVersionId: { in: versionIds } } });
    await tx.validationSchemeVersion.deleteMany({ where: { schemeId } });
    await writeAuditEvent(tx, {
      eventType: "scheme_deleted",
      actorUserId: actor.userId,
      actorRole: actor.role,
      clientId: scheme.clientId,
      targetType: "ValidationScheme",
      targetId: schemeId,
      action: "hard_delete",
      source: "api",
    });
    await tx.validationScheme.delete({ where: { id: schemeId } });
    return { hardDeleted: true };
  }

  await archiveSchemeService(tx, actor, schemeId, scheme.version);
  return { hardDeleted: false };
}
