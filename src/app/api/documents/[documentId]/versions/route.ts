import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedDocumentWhere } from "@/lib/documents/scoping";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    const document = await tx.document.findFirst({
      where: { AND: [{ id: documentId }, scopedDocumentWhere(auth)] },
      select: { id: true },
    });
    if (!document) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.view", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const versions = await tx.documentVersion.findMany({
      where: { documentId },
      include: { sourceFile: { select: { originalFilename: true, mimeType: true, byteSize: true, pageCount: true } } },
      orderBy: { versionNumber: "desc" },
    });
    return Response.json(versions);
  }
);
