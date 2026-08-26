import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedDocumentWhere } from "@/lib/documents/scoping";
import { getDefaultStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Streams bytes for one specific, immutable DocumentVersion. Never exposes a
 * permanent raw storage URL (spec §9/§26) — authorization is rechecked on
 * every single request via scopedDocumentWhere + can(), exactly like every
 * other Document route, never cached or assumed from a prior request.
 */
export const GET = withAuth(
  async (
    _req: NextRequest,
    auth,
    tx,
    { params }: { params: Promise<{ documentId: string; versionId: string }> }
  ) => {
    const { documentId, versionId } = await params;

    const version = await tx.documentVersion.findFirst({
      where: { AND: [{ id: versionId, documentId }, { document: scopedDocumentWhere(auth) }] },
      include: { sourceFile: true },
    });
    if (!version) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.download", { type: "Case" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const storage = getDefaultStorageAdapter();
    if (!(await storage.exists(version.sourceFile.storageKey))) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const nodeStream = storage.createReadStream(version.sourceFile.storageKey);
    const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream;

    const safeFilename = version.sourceFile.originalFilename.replace(/[^\w.\- ]/g, "_");
    return new Response(webStream, {
      headers: {
        "Content-Type": version.sourceFile.mimeType,
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Content-Length": String(version.sourceFile.byteSize),
      },
    });
  }
);
