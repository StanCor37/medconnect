import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { getClassificationResultService } from "@/lib/documents/extractedFieldsService";
import { DocumentServiceError, documentErrorStatus } from "@/lib/documents/service";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ documentId: string }> }) => {
    const { documentId } = await params;
    try {
      const result = await getClassificationResultService(tx, auth, documentId);
      return Response.json(result);
    } catch (err) {
      if (err instanceof DocumentServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: documentErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
