import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";
import { startValidationRunService, ValidationServiceError, validationErrorStatus } from "@/lib/validation/engine/service";
import { versionOnlySchema } from "@/lib/validation/case";

/** Client Admin requesting a revalidation on a Case shared with them (spec §4's "client_requested_revalidation" trigger). */
export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;

    const decision = can(auth, "case.requestRevalidation", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const caseRow = await tx.case.findFirst({ where: { AND: [{ id: caseId }, scopedCaseWhere(auth)] } });
    if (!caseRow) return Response.json({ error: "not_found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = versionOnlySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }
    if (caseRow.version !== parsed.data.version) {
      return Response.json({ error: "stale_version", message: "This Case changed before your action was completed. Reload it and try again." }, { status: 409 });
    }

    try {
      const run = await startValidationRunService(tx, auth, caseId, "client_requested_revalidation");
      return Response.json(run, { status: 201 });
    } catch (err) {
      if (err instanceof ValidationServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: validationErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
