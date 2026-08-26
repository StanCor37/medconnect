import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { correctExtractedFieldService } from "@/lib/documents/extractedFieldsService";
import { DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";
import { correctExtractedFieldSchema } from "@/lib/validation/document";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string; fieldDefinitionId: string }> }) => {
    const { documentId, fieldDefinitionId } = await params;

    const body = await req.json().catch(() => null);
    const parsed = correctExtractedFieldSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await correctExtractedFieldService(tx, auth, documentId, fieldDefinitionId, parsed.data.value, parsed.data.reason);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
