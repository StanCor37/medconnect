import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedHitlTaskWhere } from "@/lib/hitl/scoping";

/** Client Admin's decision inbox / Provider's read-only list — both scoped identically via scopedHitlTaskWhere. */
export const GET = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "hitl.view", { type: "HitlTask", clientId: auth.clientId });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const statuses = ["open", "in_review", "waiting_for_provider", "resolved", "cancelled", "superseded"];

  const tasks = await tx.hitlTask.findMany({
    where: {
      ...scopedHitlTaskWhere(auth),
      status: status && statuses.includes(status) ? (status as never) : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { ruleResult: { include: { ruleVersion: true } }, case: true },
  });
  return Response.json(tasks);
});
