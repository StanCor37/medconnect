import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus, TransitionActorType, TransitionSource } from "@/generated/prisma/enums";
import type { AuthContext } from "@/lib/authz/can";
import { writeAuditEvent } from "@/lib/audit/record";
import { CaseServiceError } from "@/lib/cases/errors";

/**
 * Spec §7's transition table, transcribed exactly, with one deliberate
 * addition: every status's own list includes "archived" as a legal target,
 * not just terminal ones. This preserves deleteCaseService's existing,
 * already-shipped soft-delete fallback (archiveCaseService sets
 * status="archived" from ANY current status when a Case isn't eligible for
 * a hard delete) — see the Segment 8 plan's "real tension" note for why this
 * is a deliberate, documented deviation from spec §15's literal
 * terminal-status-only framing rather than a second, differently-named
 * archive function.
 *
 * Reopening (terminal → "draft") is NOT in this table — it's not a plain
 * "current status's next status," it's a role-gated, reason-required jump
 * handled by its own guard in reopenCaseService, checked separately from
 * this table by transitionCaseStatus's caller (see the `allowReopen` escape
 * hatch below).
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  draft: ["documents_in_progress", "ready_for_validation", "cancelled", "archived"],
  documents_in_progress: ["ready_for_validation", "provider_action_required", "cancelled", "archived"],
  ready_for_validation: ["validating", "cancelled", "archived"],
  // "documents_in_progress" is an addition beyond spec §7's literal table:
  // spec §10 maps an "incomplete" validation result back to
  // documents_in_progress, so a run that discovers missing documents must be
  // able to land there directly from "validating".
  validating: ["provider_action_required", "client_review_required", "validated", "validated_with_issues", "documents_in_progress", "archived"],
  provider_action_required: ["documents_in_progress", "ready_for_validation", "validating", "cancelled", "archived"],
  client_review_required: ["returned_to_provider", "validated", "validated_with_issues", "submitted_to_client", "rejected", "archived"],
  // "validating" is additionally reachable directly from validated/
  // validated_with_issues — a deliberate, small extension beyond spec §7's
  // literal table (which routes revalidation through ready_for_validation
  // first): the intermediate state would never be observably committed
  // anyway (startValidationRunService transitions straight to "validating"
  // inside its own single transaction), so requiring a pointless extra hop
  // through ready_for_validation adds no real state-machine value here.
  validated: ["submitted_to_client", "closed", "ready_for_validation", "validating", "cancelled", "archived"],
  validated_with_issues: [
    "documents_in_progress",
    "ready_for_validation",
    "validating",
    "client_review_required",
    "submitted_to_client",
    "closed",
    "cancelled",
    "archived",
  ],
  submitted_to_client: ["client_review_required", "returned_to_provider", "accepted", "rejected", "cancelled", "archived"],
  returned_to_provider: ["documents_in_progress", "ready_for_validation", "validating", "submitted_to_client", "cancelled", "archived"],
  accepted: ["liquidated", "closed", "archived"],
  rejected: ["archived"],
  liquidated: ["archived"], // never reopenable through the standard flow — spec's own carve-out
  closed: ["archived"],
  cancelled: ["archived"],
  archived: [], // reachable only via reopenCaseService's own explicit guard, not this table
};

export interface TransitionCaseStatusInput {
  toStatus: CaseStatus;
  expectedVersion: number;
  actorType: TransitionActorType;
  source: TransitionSource;
  reasonCode?: string | null;
  reason?: string | null;
  /** Set only by reopenCaseService — bypasses CASE_TRANSITIONS' normal table for the one legitimate "jump back" this segment supports. */
  allowReopen?: boolean;
}

/**
 * The single place spec §7's "reject every unlisted transition in the
 * backend" is enforced — every action-specific service function below calls
 * this exactly once, after its own prerequisite checks, rather than
 * re-implementing the table per action. Also the single place
 * CaseStatusHistory rows are created, satisfying §16's "never update
 * current status without history."
 */
export async function transitionCaseStatus(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  caseId: string,
  input: TransitionCaseStatusInput
) {
  const existing = await tx.case.findUnique({ where: { id: caseId } });
  if (!existing) throw new CaseServiceError("not_found", "Case not found");

  const allowed = input.allowReopen ? existing.status !== "liquidated" : CASE_TRANSITIONS[existing.status].includes(input.toStatus);
  if (!allowed) {
    throw new CaseServiceError("invalid_transition", `Cannot move a Case from "${existing.status}" to "${input.toStatus}"`);
  }

  const result = await tx.case.updateMany({
    where: { id: caseId, version: input.expectedVersion },
    data: {
      status: input.toStatus,
      version: { increment: 1 },
      ...(input.toStatus === "archived"
        ? { archivedAt: new Date(), statusBeforeArchive: existing.status }
        : existing.status === "archived"
          ? { archivedAt: null, statusBeforeArchive: null } // leaving "archived" (restore, or a future path) always clears both together
          : {}),
    },
  });
  if (result.count === 0) {
    throw new CaseServiceError("stale_version", "This Case changed before your action was completed. Reload it and try again.");
  }

  await tx.caseStatusHistory.create({
    data: {
      caseId,
      fromStatus: existing.status,
      toStatus: input.toStatus,
      actorUserId: input.actorType === "system" ? null : actor.userId,
      actorType: input.actorType,
      reasonCode: input.reasonCode ?? null,
      reason: input.reason ?? null,
      source: input.source,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "case_status_changed",
    actorUserId: input.actorType === "system" ? null : actor.userId,
    actorRole: input.actorType === "system" ? null : actor.role,
    providerId: existing.providerId,
    clientId: existing.clientId,
    caseId,
    targetType: "Case",
    targetId: caseId,
    action: "status_change",
    source: input.actorType === "system" ? "system" : "api",
    reasonCode: `${existing.status}->${input.toStatus}${input.reasonCode ? `:${input.reasonCode}` : ""}`,
  });

  return tx.case.findUniqueOrThrow({ where: { id: caseId } });
}
