import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadDocumentResource } from "@/lib/documents/loadDocumentResource";
import { archiveDocumentService, DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";
import { versionOnlySchema } from "@/lib/validation/case";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    const found = await loadDocumentResource(tx, documentId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.archive", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = versionOnlySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await archiveDocumentService(tx, auth, documentId, parsed.data.version);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
