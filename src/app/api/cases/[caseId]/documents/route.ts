import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadCaseResource } from "@/lib/cases/loadCaseResource";
import { scopedDocumentWhere } from "@/lib/documents/scoping";
import { uploadDocumentsService, DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";
import { getDefaultStorageAdapter } from "@/lib/storage";
import { NoOpMalwareScanner } from "@/lib/documents/malwareScanner";
import { getDefaultOcrClient } from "@/lib/processing/ocrClient";
import { uploadDocumentFieldsSchema } from "@/lib/validation/document";

export const runtime = "nodejs";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.view", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const documents = await tx.document.findMany({
      where: { AND: [{ caseId }, scopedDocumentWhere(auth)] },
      include: { currentVersion: true },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(documents);
  }
);

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ caseId: string }> }) => {
    const { caseId } = await params;
    const found = await loadCaseResource(tx, caseId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "document.upload", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "invalid_input", message: "Expected multipart/form-data" }, { status: 400 });

    const parsed = uploadDocumentFieldsSchema.safeParse({
      documentTypeCode: form.get("documentTypeCode")?.toString() || undefined,
    });
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    const rawFiles = form.getAll("files").filter((v): v is File => v instanceof File);
    if (rawFiles.length === 0) {
      return Response.json({ error: "invalid_input", message: "At least one file is required" }, { status: 400 });
    }
    const files = await Promise.all(
      rawFiles.map(async (f) => ({ originalFilename: f.name, buffer: Buffer.from(await f.arrayBuffer()) }))
    );

    try {
      const results = await uploadDocumentsService(
        tx,
        getDefaultStorageAdapter(),
        new NoOpMalwareScanner(),
        getDefaultOcrClient(),
        auth,
        caseId,
        files,
        parsed.data.documentTypeCode
      );
      return Response.json(results, { status: 201 });
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
