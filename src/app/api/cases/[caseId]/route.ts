import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";
import { updateCaseService, deleteCaseService, caseErrorStatus, CaseServiceError } from "@/lib/cases/service";
import { updateCaseSchema } from "@/lib/validation/case";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;

    // AND (not a naive spread) — scopedCaseWhere can itself contain a
    // providerId-based filter, matching the established anti-key-collision
    // pattern from Segment 1-2's provider/client single-item routes.
    const found = await tx.case.findFirst({
      where: { AND: [{ id: caseId }, scopedCaseWhere(auth)] },
    });
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "case.view", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    return Response.json(found);
  }
);

export const PATCH = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "case.update", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = updateCaseSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await updateCaseService(tx, auth, caseId, parsed.data);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof CaseServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: caseErrorStatus(err.code) });
      }
      throw err;
    }
  }
);

export const DELETE = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "case.delete", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    try {
      const result = await deleteCaseService(tx, auth, caseId);
      return Response.json(result);
    } catch (err) {
      if (err instanceof CaseServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: caseErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
