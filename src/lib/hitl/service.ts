import type { Prisma } from "@/generated/prisma/client";
import type { HitlStatus } from "@/generated/prisma/enums";
import type { AuthContext } from "@/lib/authz/can";
import { can } from "@/lib/authz/can";
import { scopedHitlTaskWhere } from "@/lib/hitl/scoping";
import { writeAuditEvent } from "@/lib/audit/record";
import type { DecideHitlTaskInput } from "@/lib/validation/hitl";

export class HitlServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function hitlErrorStatus(code: string): number {
  switch (code) {
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "stale_version":
      return 409;
    case "invalid_state":
      return 409;
    default:
      return 400;
  }
}

const STATUS_BY_DECISION: Record<DecideHitlTaskInput["decision"], HitlStatus> = {
  confirm: "resolved",
  override_to_pass: "resolved",
  override_to_fail: "resolved",
  request_documents: "waiting_for_provider",
  return_to_provider: "resolved",
};

/**
 * Never mutates ValidationRuleResult (spec §15: "automated and human
 * outcomes remain separate") — a decision is a parallel HitlDecision row
 * layered next to the automated outcome it responds to, and only
 * HitlTask.status changes. Optimistic concurrency on HitlTask.version
 * (spec §26 "reject stale updates... require reload").
 */
export async function decideHitlTaskService(tx: Prisma.TransactionClient, actor: AuthContext, taskId: string, input: DecideHitlTaskInput) {
  const task = await tx.hitlTask.findFirst({
    where: { AND: [{ id: taskId }, scopedHitlTaskWhere(actor)] },
    include: { ruleResult: true, case: true },
  });
  if (!task) throw new HitlServiceError("not_found", "HITL task not found");

  const decision = can(actor, "hitl.decide", { type: "HitlTask", clientId: task.assignedClientId });
  if (!decision.allowed) throw new HitlServiceError(decision.status === 404 ? "not_found" : "forbidden", "Not allowed");

  // Defense-in-depth alongside decideHitlTaskSchema's own Zod refine — this
  // invariant (spec §19: "every override requires a reason") must hold for
  // every caller of this service, not just ones that went through the
  // Zod-validated route.
  if ((input.decision === "override_to_pass" || input.decision === "override_to_fail") && !input.reason?.trim()) {
    throw new HitlServiceError("invalid_input", "A reason is required to override an automated outcome");
  }

  if (task.status === "resolved" || task.status === "cancelled" || task.status === "superseded") {
    throw new HitlServiceError("invalid_state", "This HITL task is no longer open");
  }

  const newStatus = STATUS_BY_DECISION[input.decision];
  const result = await tx.hitlTask.updateMany({
    where: { id: taskId, version: input.version },
    data: {
      status: newStatus,
      version: { increment: 1 },
      ...(newStatus === "resolved" ? { resolvedAt: new Date(), resolvedByUserId: actor.userId } : {}),
    },
  });
  if (result.count === 0) {
    throw new HitlServiceError("stale_version", "This HITL task changed before your action was completed. Reload it and try again.");
  }

  await tx.hitlDecision.create({
    data: {
      hitlTaskId: taskId,
      automatedOutcome: task.ruleResult.outcome,
      decision: input.decision,
      reasonCode: input.reasonCode ?? null,
      reason: input.reason ?? null,
      decidedByUserId: actor.userId,
    },
  });

  await writeAuditEvent(tx, {
    eventType: input.decision === "override_to_pass" || input.decision === "override_to_fail" ? "hitl_overridden" : "hitl_resolved",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: task.case.providerId,
    clientId: task.case.clientId,
    caseId: task.caseId,
    targetType: "HitlTask",
    targetId: task.id,
    action: input.decision,
    source: "api",
    reasonCode: input.reasonCode ?? null,
  });

  return tx.hitlTask.findUniqueOrThrow({ where: { id: taskId }, include: { decisions: true } });
}
