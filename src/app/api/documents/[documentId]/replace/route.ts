import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadDocumentResource } from "@/lib/documents/loadDocumentResource";
import { replaceDocumentVersionService, DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";
import { getDefaultStorageAdapter } from "@/lib/storage";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { getDefaultOcrClient } from "@/lib/processing/ocrClient";
import { replaceDocumentFieldsSchema } from "@/lib/validation/document";

export const runtime = "nodejs";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    const found = await loadDocumentResource(tx, documentId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.replace", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "invalid_input", message: "Expected multipart/form-data" }, { status: 400 });

    const parsed = replaceDocumentFieldsSchema.safeParse({
      version: form.get("version")?.toString(),
      replacementReason: form.get("replacementReason")?.toString(),
      documentTypeCode: form.get("documentTypeCode")?.toString() || undefined,
    });
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    const rawFile = form.get("file");
    if (!(rawFile instanceof File)) {
      return Response.json({ error: "invalid_input", message: "A single file is required" }, { status: 400 });
    }
    const file = { originalFilename: rawFile.name, buffer: Buffer.from(await rawFile.arrayBuffer()) };

    try {
      const updated = await replaceDocumentVersionService(
        tx,
        getDefaultStorageAdapter(),
        new NoOpMalwareScanner(),
        getDefaultOcrClient(),
        auth,
        documentId,
        parsed.data.version,
        { file, replacementReason: parsed.data.replacementReason, documentTypeCode: parsed.data.documentTypeCode }
      );
      return Response.json(updated);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
