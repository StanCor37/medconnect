import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { confirmExtractedFieldService } from "@/lib/documents/extractedFieldsService";
import { DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";

export const POST = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string; fieldDefinitionId: string }> }) => {
    const { documentId, fieldDefinitionId } = await params;
    try {
      const updated = await confirmExtractedFieldService(tx, auth, documentId, fieldDefinitionId);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
