import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { listExtractedFieldsService } from "@/lib/documents/extractedFieldsService";
import { DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    try {
      const fields = await listExtractedFieldsService(tx, auth, documentId);
      return Response.json(fields);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
