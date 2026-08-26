import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { decideHitlTaskService, HitlServiceError, hitlErrorStatus } from "@/lib/hitl/service";
import { decideHitlTaskSchema } from "@/lib/validation/hitl";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ taskId: string }> }) => {
    const { taskId } = await params;

    const body = await req.json().catch(() => null);
    const parsed = decideHitlTaskSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await decideHitlTaskService(tx, auth, taskId, parsed.data);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof HitlServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: hitlErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
