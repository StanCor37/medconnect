import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadSchemeResource } from "@/lib/schemes/loadSchemeResource";
import { publishSchemeVersionService, SchemeServiceError, schemeErrorStatus } from "@/lib/schemes/service";
import { publishSchemeSchema } from "@/lib/validation/scheme";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ schemeId: string }> }) => {
    const { schemeId } = await params;
    const found = await loadSchemeResource(tx, schemeId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "scheme.publish", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = publishSchemeSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await publishSchemeVersionService(tx, auth, schemeId, parsed.data.versionId, parsed.data.version);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof SchemeServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: schemeErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
