import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";
import { returnCaseToProviderService, caseErrorStatus, CaseServiceError } from "@/lib/cases/service";
import { returnCaseSchema } from "@/lib/validation/caseLifecycle";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "case.returnToProvider", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = returnCaseSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await returnCaseToProviderService(tx, auth, caseId, parsed.data);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof CaseServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: caseErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
