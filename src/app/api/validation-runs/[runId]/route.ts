import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";

/** Full run detail — rule/requirement/HITL results — visibility via a scoped join through the parent Case. */
export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ runId: string }> }) => {
    const { runId } = await params;

    const decision = can(auth, "case.view", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const run = await tx.validationRun.findFirst({
      where: { AND: [{ id: runId }, { case: scopedCaseWhere(auth) }] },
      include: {
        requirementResults: true,
        ruleResults: { include: { ruleVersion: true, hitlTask: true } },
        hitlTasks: true,
      },
    });
    if (!run) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json(run);
  }
);
