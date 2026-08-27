import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";
import { writeAuditEvent } from "@/lib/audit/record";
import {
  resolvePeriod,
  previousPeriodWindow,
  comparePeriod,
  safe,
  getOpenCasesCount,
  getProviderActionCount,
  getClientReviewCount,
  getValidatedCount,
  getSubmittedCount,
  getAcceptedCount,
  getRejectedCount,
  getLiquidatedCount,
  getAverageClientReviewTimeMs,
  getStatusDistribution,
  getCaseAgeBuckets,
  getNeedsReviewQueue,
  getWaitingForProviderQueue,
  getHitlOutcomes,
  getTopDocumentIssues,
  getUnreadableRate,
  type PeriodKey,
} from "@/lib/analytics/overview";

const PERIOD_KEYS: PeriodKey[] = ["today", "7d", "30d", "90d"];

export const GET = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "analytics.view", { type: "Analytics", clientId: auth.clientId });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const { searchParams } = new URL(req.url);
  const periodParam = searchParams.get("period");
  const periodKey: PeriodKey = periodParam && PERIOD_KEYS.includes(periodParam as PeriodKey) ? (periodParam as PeriodKey) : "30d";

  const period = resolvePeriod(periodKey);
  const previous = previousPeriodWindow(period);

  const scopedCases = await tx.case.findMany({ where: { ...scopedCaseWhere(auth), archivedAt: null }, select: { id: true } });
  const scopedCaseIds = scopedCases.map((c) => c.id);

  const [kpis, statusDistribution, ageBuckets, needsReview, waitingForProvider, hitlOutcomes, documentIssues] = await Promise.all([
    safe(async () => {
      const [openCases, providerAction, clientReview] = await Promise.all([
        getOpenCasesCount(tx, scopedCaseIds),
        getProviderActionCount(tx, scopedCaseIds),
        getClientReviewCount(tx, scopedCaseIds),
      ]);
      const [validatedCur, validatedPrev] = await Promise.all([
        getValidatedCount(tx, scopedCaseIds, period.from, period.to),
        getValidatedCount(tx, scopedCaseIds, previous.from, previous.to),
      ]);
      const [submittedCur, submittedPrev] = await Promise.all([
        getSubmittedCount(tx, scopedCaseIds, period.from, period.to),
        getSubmittedCount(tx, scopedCaseIds, previous.from, previous.to),
      ]);
      const [acceptedCur, acceptedPrev] = await Promise.all([
        getAcceptedCount(tx, scopedCaseIds, period.from, period.to),
        getAcceptedCount(tx, scopedCaseIds, previous.from, previous.to),
      ]);
      const [rejectedCur, rejectedPrev] = await Promise.all([
        getRejectedCount(tx, scopedCaseIds, period.from, period.to),
        getRejectedCount(tx, scopedCaseIds, previous.from, previous.to),
      ]);
      const [liquidatedCur, liquidatedPrev] = await Promise.all([
        getLiquidatedCount(tx, scopedCaseIds, period.from, period.to),
        getLiquidatedCount(tx, scopedCaseIds, previous.from, previous.to),
      ]);
      const avgReviewTimeMs = await getAverageClientReviewTimeMs(tx, scopedCaseIds, period.from, period.to);

      return {
        openCases,
        providerAction,
        clientReview,
        validated: comparePeriod(validatedCur, validatedPrev),
        submitted: comparePeriod(submittedCur, submittedPrev),
        accepted: comparePeriod(acceptedCur, acceptedPrev),
        rejected: comparePeriod(rejectedCur, rejectedPrev),
        liquidated: comparePeriod(liquidatedCur, liquidatedPrev),
        avgReviewTimeMs,
      };
    }),
    safe(() => getStatusDistribution(tx, scopedCaseIds)),
    safe(() => getCaseAgeBuckets(tx, scopedCaseIds)),
    safe(() => getNeedsReviewQueue(tx, auth)),
    safe(() => getWaitingForProviderQueue(tx, scopedCaseIds)),
    safe(() => getHitlOutcomes(tx, auth, period.from, period.to)),
    safe(async () => {
      const [issues, unreadableRate] = await Promise.all([
        getTopDocumentIssues(tx, scopedCaseIds),
        getUnreadableRate(tx, scopedCaseIds, period.from, period.to),
      ]);
      return { issues, unreadableRate };
    }),
  ]);

  await writeAuditEvent(tx, {
    eventType: "admin_dashboard_opened",
    actorUserId: auth.userId,
    actorRole: auth.role,
    clientId: auth.clientId,
    targetType: "Client",
    targetId: auth.clientId!,
    action: "view",
    source: "api",
  });

  return Response.json({
    period: { key: period.key, from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
    lastUpdated: new Date().toISOString(),
    sections: { kpis, statusDistribution, ageBuckets, needsReview, waitingForProvider, hitlOutcomes, documentIssues },
  });
});
