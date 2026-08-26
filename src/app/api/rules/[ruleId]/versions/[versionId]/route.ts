import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadRuleResource } from "@/lib/rules/loadRuleResource";
import { updateDraftVersionService, RuleServiceError, ruleErrorStatus } from "@/lib/rules/service";
import { updateDraftVersionSchema } from "@/lib/validation/rule";

export const PATCH = withAuth(
  async (
    req: NextRequest,
    auth,
    tx,
    { params }: { params: Promise<{ ruleId: string; versionId: string }> }
  ) => {
    const { ruleId, versionId } = await params;
    const found = await loadRuleResource(tx, ruleId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "rule.update", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = updateDraftVersionSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await updateDraftVersionService(tx, auth, ruleId, versionId, parsed.data.version, parsed.data);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof RuleServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: ruleErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
