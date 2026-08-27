import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import type { AuthContext } from "@/lib/authz/can";
import { scopedHitlTaskWhere } from "@/lib/hitl/scoping";

/**
 * Segment 9 MVP's period model. "today" is a UTC calendar day, not a
 * trailing-24h window — a deliberate simplification: full Client-timezone
 * day/week boundaries (spec §5) need a per-Client timezone column that
 * doesn't exist in this schema yet.
 */
export type PeriodKey = "today" | "7d" | "30d" | "90d";

export interface Period {
  key: PeriodKey;
  from: Date;
  to: Date;
  label: string;
}

const PERIOD_DAYS: Record<Exclude<PeriodKey, "today">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): Period {
  const to = now;
  const from =
    key === "today"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      : new Date(now.getTime() - PERIOD_DAYS[key] * 24 * 60 * 60 * 1000);
  return { key, from, to, label: PERIOD_LABELS[key] };
}

/** The immediately preceding period of the same duration — spec §21. */
export function previousPeriodWindow(period: Period): { from: Date; to: Date } {
  const durationMs = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - durationMs), to: period.from };
}

export interface Trend {
  current: number;
  previous: number;
  /** null (never Infinity) when the previous period had zero — spec §21. */
  trend: number | null;
}

export function comparePeriod(current: number, previous: number): Trend {
  return { current, previous, trend: previous === 0 ? null : (current - previous) / previous };
}

/** Wraps one dashboard section so a failure there never blocks the rest of the page (spec §25). */
export async function safe<T>(fn: () => Promise<T>): Promise<T | { error: true }> {
  try {
    return await fn();
  } catch {
    return { error: true };
  }
}

// --- Snapshot KPIs (spec §6 — never period-filtered) ---------------------

const OPEN_CASE_EXCLUDED_STATUSES: CaseStatus[] = ["accepted", "rejected", "liquidated", "closed", "cancelled", "archived"];

/** Current Client-associated Cases not accepted, rejected, liquidated, closed, cancelled or archived. */
export async function getOpenCasesCount(tx: Prisma.TransactionClient, scopedCaseIds: string[]): Promise<number> {
  return tx.case.count({ where: { id: { in: scopedCaseIds }, status: { notIn: OPEN_CASE_EXCLUDED_STATUSES } } });
}

/** Current Cases with status provider_action_required. */
export async function getProviderActionCount(tx: Prisma.TransactionClient, scopedCaseIds: string[]): Promise<number> {
  return tx.case.count({ where: { id: { in: scopedCaseIds }, status: "provider_action_required" } });
}

/** Current Cases with status client_review_required. */
export async function getClientReviewCount(tx: Prisma.TransactionClient, scopedCaseIds: string[]): Promise<number> {
  return tx.case.count({ where: { id: { in: scopedCaseIds }, status: "client_review_required" } });
}

// --- Period KPIs (spec §5's timestamp table, §6) --------------------------

/** Cases whose CURRENT (non-superseded) Validation Run completed in-period with passed/passed_with_warnings. Timestamp: validation_run.completed_at. */
export async function getValidatedCount(
  tx: Prisma.TransactionClient,
  scopedCaseIds: string[],
  from: Date,
  to: Date
): Promise<number> {
  const runs = await tx.validationRun.findMany({
    where: {
      caseId: { in: scopedCaseIds },
      status: { not: "superseded" },
      completedAt: { gte: from, lte: to },
      overallResult: { in: ["passed", "passed_with_warnings"] },
    },
    select: { caseId: true },
    distinct: ["caseId"],
  });
  return runs.length;
}

/** Timestamp: submission.submitted_at (spec §5 — NOT a CaseStatusHistory row). */
export async function getSubmittedCount(tx: Prisma.TransactionClient, scopedCaseIds: string[], from: Date, to: Date): Promise<number> {
  return tx.caseSubmission.count({ where: { caseId: { in: scopedCaseIds }, submittedAt: { gte: from, lte: to } } });
}

/** Timestamp: case.accepted_at. */
export async function getAcceptedCount(tx: Prisma.TransactionClient, scopedCaseIds: string[], from: Date, to: Date): Promise<number> {
  return tx.case.count({ where: { id: { in: scopedCaseIds }, acceptedAt: { gte: from, lte: to } } });
}

/** Timestamp: case.rejected_at (spec §5's "rejection-transition time"). */
export async function getRejectedCount(tx: Prisma.TransactionClient, scopedCaseIds: string[], from: Date, to: Date): Promise<number> {
  return tx.case.count({ where: { id: { in: scopedCaseIds }, rejectedAt: { gte: from, lte: to } } });
}

/** Timestamp: case.liquidated_at. Never inferred from validation success (spec §6). */
export async function getLiquidatedCount(tx: Prisma.TransactionClient, scopedCaseIds: string[], from: Date, to: Date): Promise<number> {
  return tx.case.count({ where: { id: { in: scopedCaseIds }, liquidatedAt: { gte: from, lte: to } } });
}

/** Average ms from HitlTask.createdAt to resolvedAt, for tasks resolved in-period. null when no tasks resolved (never NaN/0-as-if-real). */
export async function getAverageClientReviewTimeMs(
  tx: Prisma.TransactionClient,
  scopedCaseIds: string[],
  from: Date,
  to: Date
): Promise<number | null> {
  const tasks = await tx.hitlTask.findMany({
    where: { caseId: { in: scopedCaseIds }, status: "resolved", resolvedAt: { gte: from, lte: to } },
    select: { createdAt: true, resolvedAt: true },
  });
  if (tasks.length === 0) return null;
  const totalMs = tasks.reduce((sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0);
  return totalMs / tasks.length;
}

// --- Status distribution and age (spec §9-10, snapshots) ------------------

export async function getStatusDistribution(tx: Prisma.TransactionClient, scopedCaseIds: string[]): Promise<Record<string, number>> {
  const rows = await tx.case.groupBy({ by: ["status"], where: { id: { in: scopedCaseIds } }, _count: { _all: true } });
  const result: Record<string, number> = {};
  for (const r of rows) result[r.status] = r._count._all;
  return result;
}

export const AGE_BUCKETS = ["<24h", "1-3d", "3-7d", "7-14d", "14-30d", ">30d"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function bucketAge(ageMs: number): AgeBucket {
  const hours = ageMs / (60 * 60 * 1000);
  if (hours < 24) return "<24h";
  const days = hours / 24;
  if (days < 3) return "1-3d";
  if (days < 7) return "3-7d";
  if (days < 14) return "7-14d";
  if (days < 30) return "14-30d";
  return ">30d";
}

/** Case age is current time minus creation (spec §10). */
export async function getCaseAgeBuckets(
  tx: Prisma.TransactionClient,
  scopedCaseIds: string[],
  now: Date = new Date()
): Promise<Record<AgeBucket, number>> {
  const rows = await tx.case.findMany({ where: { id: { in: scopedCaseIds } }, select: { createdAt: true } });
  const counts: Record<AgeBucket, number> = { "<24h": 0, "1-3d": 0, "3-7d": 0, "7-14d": 0, "14-30d": 0, ">30d": 0 };
  for (const r of rows) counts[bucketAge(now.getTime() - r.createdAt.getTime())]++;
  return counts;
}

// --- Operational queues (spec §7) -----------------------------------------

export interface QueueItem {
  caseId: string;
  internalReference: string;
  since: Date;
}

export interface Queue {
  total: number;
  items: QueueItem[];
}

/** "Needs my review" — open HITL tasks assigned to this Client, oldest first. */
export async function getNeedsReviewQueue(tx: Prisma.TransactionClient, auth: AuthContext, limit = 10): Promise<Queue> {
  const where = { ...scopedHitlTaskWhere(auth), status: "open" as const };
  const [total, tasks] = await Promise.all([
    tx.hitlTask.count({ where }),
    tx.hitlTask.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { case: { select: { internalReference: true } } },
    }),
  ]);
  return { total, items: tasks.map((t) => ({ caseId: t.caseId, internalReference: t.case.internalReference, since: t.createdAt })) };
}

/**
 * "Waiting for Provider" — Cases needing Provider action, oldest first.
 * Uses Case.updatedAt as a proxy for "time in status": a precise version
 * needs a per-Case latest-CaseStatusHistory-row subquery, deferred as a
 * refinement since every mutation already bumps updatedAt.
 */
export async function getWaitingForProviderQueue(tx: Prisma.TransactionClient, scopedCaseIds: string[], limit = 10): Promise<Queue> {
  const where = { id: { in: scopedCaseIds }, status: "provider_action_required" as const };
  const [total, cases] = await Promise.all([
    tx.case.count({ where }),
    tx.case.findMany({ where, orderBy: { updatedAt: "asc" }, take: limit, select: { id: true, internalReference: true, updatedAt: true } }),
  ]);
  return { total, items: cases.map((c) => ({ caseId: c.id, internalReference: c.internalReference, since: c.updatedAt })) };
}

// --- HITL outcomes (spec §11) ----------------------------------------------

export interface HitlOutcomes {
  totalDecisions: number;
  overrideRate: number | null;
  confirmationRate: number | null;
}

export async function getHitlOutcomes(tx: Prisma.TransactionClient, auth: AuthContext, from: Date, to: Date): Promise<HitlOutcomes> {
  const decisions = await tx.hitlDecision.findMany({
    where: { decidedAt: { gte: from, lte: to }, hitlTask: scopedHitlTaskWhere(auth) },
    select: { decision: true },
  });
  const total = decisions.length;
  if (total === 0) return { totalDecisions: 0, overrideRate: null, confirmationRate: null };
  const overrides = decisions.filter((d) => d.decision === "override_to_pass" || d.decision === "override_to_fail").length;
  const confirmations = decisions.filter((d) => d.decision === "confirm").length;
  return { totalDecisions: total, overrideRate: overrides / total, confirmationRate: confirmations / total };
}

// --- Document issues (spec §13, snapshot) ----------------------------------

export interface DocumentIssue {
  documentTypeCode: string;
  missingCount: number;
}

/** Missing-requirement counts by document type, from each Case's CURRENT (non-superseded) run only. */
export async function getTopDocumentIssues(tx: Prisma.TransactionClient, scopedCaseIds: string[], limit = 5): Promise<DocumentIssue[]> {
  const currentRuns = await tx.validationRun.findMany({
    where: { caseId: { in: scopedCaseIds }, status: { not: "superseded" } },
    select: { id: true },
  });
  const runIds = currentRuns.map((r) => r.id);
  if (runIds.length === 0) return [];
  const rows = await tx.requirementResult.groupBy({
    by: ["documentTypeCode"],
    where: { validationRunId: { in: runIds }, status: "missing", documentTypeCode: { not: null } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ documentTypeCode: r.documentTypeCode!, missingCount: r._count._all }))
    .sort((a, b) => b.missingCount - a.missingCount)
    .slice(0, limit);
}

/** Unreadable Document Versions / processed (non-pending) Document Versions created in-period. null when nothing processed. */
export async function getUnreadableRate(
  tx: Prisma.TransactionClient,
  scopedCaseIds: string[],
  from: Date,
  to: Date
): Promise<number | null> {
  const documents = await tx.document.findMany({ where: { caseId: { in: scopedCaseIds } }, select: { id: true } });
  const documentIds = documents.map((d) => d.id);
  if (documentIds.length === 0) return null;
  const versions = await tx.documentVersion.findMany({
    where: { documentId: { in: documentIds }, createdAt: { gte: from, lte: to }, readabilityStatus: { not: "pending" } },
    select: { readabilityStatus: true },
  });
  if (versions.length === 0) return null;
  const unreadable = versions.filter((v) => v.readabilityStatus === "unreadable").length;
  return unreadable / versions.length;
}
