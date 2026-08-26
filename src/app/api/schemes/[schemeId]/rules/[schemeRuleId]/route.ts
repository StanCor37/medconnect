import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadSchemeResource } from "@/lib/schemes/loadSchemeResource";
import {
  updateSchemeRuleService,
  removeRuleFromSchemeService,
  SchemeServiceError,
  schemeErrorStatus,
} from "@/lib/schemes/service";
import { updateSchemeRuleSchema, schemeVersionTargetSchema } from "@/lib/validation/scheme";

export const PATCH = withAuth(
  async (
    req: NextRequest,
    auth,
    tx,
    { params }: { params: Promise<{ schemeId: string; schemeRuleId: string }> }
  ) => {
    const { schemeId, schemeRuleId } = await params;
    const found = await loadSchemeResource(tx, schemeId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "scheme.update", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = updateSchemeRuleSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await updateSchemeRuleService(
        tx,
        auth,
        schemeId,
        parsed.data.schemeVersionId,
        parsed.data.version,
        schemeRuleId,
        parsed.data
      );
      return Response.json(updated);
    } catch (err) {
      if (err instanceof SchemeServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: schemeErrorStatus(err.code) });
      }
      throw err;
    }
  }
);

export const DELETE = withAuth(
  async (
    req: NextRequest,
    auth,
    tx,
    { params }: { params: Promise<{ schemeId: string; schemeRuleId: string }> }
  ) => {
    const { schemeId, schemeRuleId } = await params;
    const found = await loadSchemeResource(tx, schemeId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "scheme.update", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = schemeVersionTargetSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await removeRuleFromSchemeService(
        tx,
        auth,
        schemeId,
        parsed.data.schemeVersionId,
        parsed.data.version,
        schemeRuleId
      );
      return Response.json(updated);
    } catch (err) {
      if (err instanceof SchemeServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: schemeErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
