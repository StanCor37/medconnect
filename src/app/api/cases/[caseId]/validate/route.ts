import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";
import { startValidationRunService, ValidationServiceError, validationErrorStatus } from "@/lib/validation/engine/service";
import { versionOnlySchema } from "@/lib/validation/case";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "case.validate", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = versionOnlySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }
    if (found.caseRow.version !== parsed.data.version) {
      return Response.json({ error: "stale_version", message: "This Case changed before your action was completed. Reload it and try again." }, { status: 409 });
    }

    try {
      const run = await startValidationRunService(tx, auth, caseId, "provider_started");
      return Response.json(run, { status: 201 });
    } catch (err) {
      if (err instanceof ValidationServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: validationErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
