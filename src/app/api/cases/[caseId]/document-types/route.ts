import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";
import { resolveAvailableDocumentTypesForCase } from "@/lib/documents/documentTypes";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.view", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const types = await resolveAvailableDocumentTypesForCase(tx, found.caseRow);
    return Response.json(types);
  }
);
