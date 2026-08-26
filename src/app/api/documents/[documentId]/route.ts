import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedDocumentWhere } from "@/lib/documents/scoping";
import { loadDocumentResource } from "@/lib/documents/loadDocumentResource";
import { deleteDocumentService, DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";
import { getDefaultStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    const document = await tx.document.findFirst({
      where: { AND: [{ id: documentId }, scopedDocumentWhere(auth)] },
      include: { currentVersion: true },
    });
    if (!document) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.view", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    return Response.json(document);
  }
);

export const DELETE = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    const found = await loadDocumentResource(tx, documentId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.delete", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    try {
      const result = await deleteDocumentService(tx, getDefaultStorageAdapter(), auth, documentId);
      return Response.json(result);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
