import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
import { writeAuditEvent } from "@/lib/audit/record";
import { checkForDuplicateRule } from "@/lib/duplicate-detection/rule";
import type { CreateRuleInput, UpdateDraftVersionInput } from "@/lib/validation/rule";

export class RuleServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function ruleErrorStatus(code: string): number {
  switch (code) {
    case "duplicate_rule":
      return 409;
    case "probable_duplicate_rule":
      return 422;
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

export interface CreateRuleResult {
  rule: Prisma.ValidationRuleGetPayload<{ include: { currentVersion: true } }>;
  duplicateWarning: { candidates: { ruleId: string; ruleVersionId: string; name: string }[] } | null;
}

/**
 * Ownership is never trusted from the request body: scope/clientId are
 * forced from actor.role/actor.clientId here, exactly like
 * createAccountService/createProviderService already force ownership fields
 * — a client_admin cannot lie their way into scope:"global" by sending it
 * in the JSON body.
 */
export async function createDraftRuleService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateRuleInput
): Promise<CreateRuleResult> {
  if (actor.role !== "super_admin" && actor.role !== "client_admin") {
    throw new RuleServiceError("forbidden", "Only Super Admin or Client Admin can create Validation Rules");
  }
  const scope = actor.role === "super_admin" ? "global" : "client";
  const clientId = actor.role === "client_admin" ? actor.clientId! : null;

  const duplicate = await checkForDuplicateRule(tx, {
    clientId,
    category: input.category,
    executionType: input.executionType,
    name: input.name,
    definition: input.definition,
  });
  if (duplicate.kind === "exact_match") {
    throw new RuleServiceError("duplicate_rule", "An identical rule already exists. Use the existing rule instead.");
  }
  if (duplicate.kind === "probable_match" && !input.confirmedNotDuplicateBy) {
    throw new RuleServiceError(
      "probable_duplicate_rule",
      "A similar rule already exists. Confirm this is not a duplicate to proceed."
    );
  }

  const rule = await tx.validationRule.create({
    data: {
      scope,
      clientId,
      category: input.category,
      executionType: input.executionType,
      name: input.name,
      status: "draft",
      createdByUserId: actor.userId,
    },
  });

  const version = await tx.validationRuleVersion.create({
    data: {
      ruleId: rule.id,
      versionNumber: 1,
      name: input.name,
      description: input.description ?? null,
      definition: input.definition as Prisma.InputJsonValue,
      applicability: input.applicability as Prisma.InputJsonValue,
      providerMessageCode: input.providerMessageCode,
      adminMessageCode: input.adminMessageCode,
      severity: input.severity,
      hitlPolicy: input.hitlPolicy,
    },
  });

  const updated = await tx.validationRule.update({
    where: { id: rule.id },
    data: { currentVersionId: version.id },
    include: { currentVersion: true },
  });

  await writeAuditEvent(tx, {
    eventType: "rule_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId,
    targetType: "ValidationRule",
    targetId: rule.id,
    action: "create",
    source: "api",
  });
  await writeAuditEvent(tx, {
    eventType: "rule_version_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId,
    targetType: "ValidationRuleVersion",
    targetId: version.id,
    action: "create",
    source: "api",
  });
  if (duplicate.kind === "probable_match") {
    await writeAuditEvent(tx, {
      eventType: "rule_duplicate_warning_overridden",
      actorUserId: actor.userId,
      actorRole: actor.role,
      clientId,
      targetType: "ValidationRule",
      targetId: rule.id,
      action: "confirm_not_duplicate",
      source: "api",
    });
  }

  return {
    rule: updated,
    duplicateWarning: duplicate.kind === "probable_match" ? duplicate : null,
  };
}

/**
 * Legal against ANY of the Rule's own unpublished versions — not just the
 * current one. Before this fix, the function required `versionId ===
 * rule.currentVersionId`, which made a version created by
 * createNextDraftVersionService (which deliberately does NOT move
 * currentVersionId until publish) permanently unreachable for editing. The
 * `ruleId` filter on the updateMany below is what now enforces "this version
 * actually belongs to this Rule" — that guarantee used to come from the
 * currentVersionId comparison, so it can't simply be dropped without a
 * replacement (a versionId belonging to a DIFFERENT Rule must still be
 * rejected, not silently updated).
 */
export async function updateDraftVersionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  ruleId: string,
  versionId: string,
  expectedRuleVersion: number,
  patch: UpdateDraftVersionInput
) {
  const rule = await tx.validationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new RuleServiceError("not_found", "Rule not found");

  const { version: _version, ...data } = patch;
  void _version;
  const result = await tx.validationRuleVersion.updateMany({
    where: { id: versionId, ruleId, publishedAt: null },
    data: data as Prisma.ValidationRuleVersionUpdateManyMutationInput,
  });
  if (result.count === 0) {
    throw new RuleServiceError(
      "invalid_state",
      "This version was not found on this Rule, or is already published and cannot be edited"
    );
  }

  // Serialize concurrent edits via the parent Rule's optimistic-concurrency
  // version. Rule.name only mirrors THIS edit when versionId is the actual
  // current version — editing a future, not-yet-published draft (versionNumber
  // 2 while version 1 is still current) must never overwrite the Rule's
  // displayed name with content that isn't live yet; publishRuleVersionService
  // is what updates Rule.name, exactly when that draft actually goes live.
  const bump = await tx.validationRule.updateMany({
    where: { id: ruleId, version: expectedRuleVersion },
    data: {
      version: { increment: 1 },
      ...(rule.currentVersionId === versionId ? { name: patch.name ?? undefined } : {}),
    },
  });
  if (bump.count === 0) {
    throw new RuleServiceError("stale_version", "This Rule changed before your action was completed. Reload it and try again.");
  }

  const updatedVersion = await tx.validationRuleVersion.findUniqueOrThrow({ where: { id: versionId } });

  await writeAuditEvent(tx, {
    eventType: "rule_version_updated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: rule.clientId,
    targetType: "ValidationRuleVersion",
    targetId: versionId,
    action: "update",
    source: "api",
    reasonCode: `fields:${Object.keys(data).join(",")}`,
  });

  return updatedVersion;
}

/** Only legal when the rule's current version is published — "editing a published rule creates a new draft version." */
export async function createNextDraftVersionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  ruleId: string,
  expectedRuleVersion: number
) {
  const rule = await tx.validationRule.findUnique({ where: { id: ruleId }, include: { currentVersion: true } });
  if (!rule) throw new RuleServiceError("not_found", "Rule not found");
  if (rule.status !== "published" || !rule.currentVersion) {
    throw new RuleServiceError("invalid_state", "Only a published Rule can start a new draft version");
  }

  const bump = await tx.validationRule.updateMany({
    where: { id: ruleId, version: expectedRuleVersion },
    data: { version: { increment: 1 } },
  });
  if (bump.count === 0) {
    throw new RuleServiceError("stale_version", "This Rule changed before your action was completed. Reload it and try again.");
  }

  const current = rule.currentVersion;
  const nextVersion = await tx.validationRuleVersion.create({
    data: {
      ruleId,
      versionNumber: current.versionNumber + 1,
      name: current.name,
      description: current.description,
      definition: current.definition as Prisma.InputJsonValue,
      applicability: current.applicability as Prisma.InputJsonValue,
      providerMessageCode: current.providerMessageCode,
      adminMessageCode: current.adminMessageCode,
      severity: current.severity,
      hitlPolicy: current.hitlPolicy,
      // publishedAt stays null — currentVersionId is NOT moved until this is explicitly published.
    },
  });

  await writeAuditEvent(tx, {
    eventType: "rule_version_created",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: rule.clientId,
    targetType: "ValidationRuleVersion",
    targetId: nextVersion.id,
    action: "create_next_draft",
    source: "api",
  });

  return nextVersion;
}

export async function publishRuleVersionService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  ruleId: string,
  versionId: string,
  expectedRuleVersion: number
) {
  const rule = await tx.validationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new RuleServiceError("not_found", "Rule not found");
  const version = await tx.validationRuleVersion.findUnique({ where: { id: versionId } });
  if (!version || version.ruleId !== ruleId) throw new RuleServiceError("not_found", "Rule version not found");
  if (version.publishedAt !== null) throw new RuleServiceError("invalid_state", "This version is already published");

  await tx.validationRuleVersion.update({
    where: { id: versionId },
    data: { publishedAt: new Date(), publishedByUserId: actor.userId },
  });

  const result = await tx.validationRule.updateMany({
    where: { id: ruleId, version: expectedRuleVersion },
    data: { currentVersionId: versionId, status: "published", name: version.name, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new RuleServiceError("stale_version", "This Rule changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.validationRule.findUniqueOrThrow({ where: { id: ruleId }, include: { currentVersion: true } });

  await writeAuditEvent(tx, {
    eventType: "rule_published",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: rule.clientId,
    targetType: "ValidationRule",
    targetId: ruleId,
    action: "publish",
    source: "api",
  });

  return updated;
}

export async function archiveRuleService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  ruleId: string,
  expectedRuleVersion: number
) {
  const rule = await tx.validationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new RuleServiceError("not_found", "Rule not found");
  if (rule.status === "archived") throw new RuleServiceError("invalid_state", "Rule is already archived");

  const result = await tx.validationRule.updateMany({
    where: { id: ruleId, version: expectedRuleVersion },
    data: { status: "archived", archivedAt: new Date(), version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new RuleServiceError("stale_version", "This Rule changed before your action was completed. Reload it and try again.");
  }

  const updated = await tx.validationRule.findUniqueOrThrow({ where: { id: ruleId } });

  await writeAuditEvent(tx, {
    eventType: "rule_archived",
    actorUserId: actor.userId,
    actorRole: actor.role,
    clientId: rule.clientId,
    targetType: "ValidationRule",
    targetId: ruleId,
    action: "archive",
    source: "api",
  });

  return updated;
}

/**
 * Creates a brand-new global Rule sourced from a Client-owned one. The
 * original is never written to anywhere in this function — enforced by
 * construction (no update() call against the source rule exists in this
 * function body at all).
 */
export async function promoteRuleToGlobalService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  sourceRuleId: string,
  sourceVersionId: string,
  confirmedNotDuplicateBy?: string
) {
  if (actor.role !== "super_admin") {
    throw new RuleServiceError("forbidden", "Only Super Admin can promote a Rule to global");
  }
  const sourceRule = await tx.validationRule.findUnique({ where: { id: sourceRuleId } });
  if (!sourceRule) throw new RuleServiceError("not_found", "Source rule not found");
  if (sourceRule.scope !== "client") {
    throw new RuleServiceError("invalid_state", "Only a Client-owned Rule can be promoted");
  }
  const sourceVersion = await tx.validationRuleVersion.findUnique({ where: { id: sourceVersionId } });
  if (!sourceVersion || sourceVersion.ruleId !== sourceRuleId) {
    throw new RuleServiceError("not_found", "Source rule version not found");
  }

  const duplicate = await checkForDuplicateRule(tx, {
    clientId: null, // check against the GLOBAL pool only
    category: sourceRule.category,
    executionType: sourceRule.executionType,
    name: sourceVersion.name,
    definition: sourceVersion.definition as never,
  });
  if (duplicate.kind === "exact_match") {
    throw new RuleServiceError("duplicate_rule", "An identical global rule already exists.");
  }
  if (duplicate.kind === "probable_match" && !confirmedNotDuplicateBy) {
    throw new RuleServiceError("probable_duplicate_rule", "A similar global rule already exists. Confirm this is not a duplicate to proceed.");
  }

  const newRule = await tx.validationRule.create({
    data: {
      scope: "global",
      clientId: null,
      category: sourceRule.category,
      executionType: sourceRule.executionType,
      name: sourceVersion.name,
      status: "draft",
      sourceRuleId,
      sourceRuleVersionId: sourceVersionId,
      createdByUserId: actor.userId,
    },
  });

  const newVersion = await tx.validationRuleVersion.create({
    data: {
      ruleId: newRule.id,
      versionNumber: 1,
      name: sourceVersion.name,
      description: sourceVersion.description,
      definition: sourceVersion.definition as Prisma.InputJsonValue,
      applicability: sourceVersion.applicability as Prisma.InputJsonValue,
      providerMessageCode: sourceVersion.providerMessageCode,
      adminMessageCode: sourceVersion.adminMessageCode,
      severity: sourceVersion.severity,
      hitlPolicy: sourceVersion.hitlPolicy,
      // publishedAt stays null — promotion always produces a draft, never auto-published.
    },
  });

  const updated = await tx.validationRule.update({
    where: { id: newRule.id },
    data: { currentVersionId: newVersion.id },
    include: { currentVersion: true },
  });

  await writeAuditEvent(tx, {
    eventType: "rule_promoted",
    actorUserId: actor.userId,
    actorRole: actor.role,
    targetType: "ValidationRule",
    targetId: newRule.id,
    action: "promote",
    source: "api",
    reasonCode: `promoted_from:${sourceRuleId}:${sourceVersionId}`,
  });

  return updated;
}

export interface DeleteRuleResult {
  hardDeleted: boolean;
}

export async function deleteRuleService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  ruleId: string
): Promise<DeleteRuleResult> {
  const rule = await tx.validationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new RuleServiceError("not_found", "Rule not found");

  const publishedVersionCount = await tx.validationRuleVersion.count({
    where: { ruleId, publishedAt: { not: null } },
  });
  const schemeReferenceCount = await tx.validationSchemeRule.count({
    where: { ruleVersion: { ruleId } },
  });
  const eligibleForHardDelete = publishedVersionCount === 0 && schemeReferenceCount === 0;

  if (eligibleForHardDelete) {
    // Clear the circular currentVersionId pointer first so version rows can be deleted.
    await tx.validationRule.update({ where: { id: ruleId }, data: { currentVersionId: null } });
    await tx.validationRuleVersion.deleteMany({ where: { ruleId } });
    await writeAuditEvent(tx, {
      eventType: "rule_deleted",
      actorUserId: actor.userId,
      actorRole: actor.role,
      clientId: rule.clientId,
      targetType: "ValidationRule",
      targetId: ruleId,
      action: "hard_delete",
      source: "api",
    });
    await tx.validationRule.delete({ where: { id: ruleId } });
    return { hardDeleted: true };
  }

  await archiveRuleService(tx, actor, ruleId, rule.version);
  return { hardDeleted: false };
}
