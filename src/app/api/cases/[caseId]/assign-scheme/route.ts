import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";
import { assignSchemeVersionService, CaseServiceError, caseErrorStatus } from "@/lib/cases/service";
import { assignSchemeSchema } from "@/lib/validation/scheme";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "case.assignScheme", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = assignSchemeSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await assignSchemeVersionService(tx, auth, caseId, parsed.data.schemeVersionId, parsed.data.version);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof CaseServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: caseErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
