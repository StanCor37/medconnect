import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";

/** spec §22: run history, newest first — visibility via the same scoped join every other Case-linked read uses. */
export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;

    const decision = can(auth, "case.view", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const caseRow = await tx.case.findFirst({ where: { AND: [{ id: caseId }, scopedCaseWhere(auth)] } });
    if (!caseRow) return Response.json({ error: "not_found" }, { status: 404 });

    const runs = await tx.validationRun.findMany({
      where: { caseId },
      orderBy: { runNumber: "desc" },
    });
    return Response.json(runs);
  }
);
