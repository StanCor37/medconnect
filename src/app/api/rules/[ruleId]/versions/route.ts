import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadRuleResource } from "@/lib/rules/loadRuleResource";
import { createNextDraftVersionService, RuleServiceError, ruleErrorStatus } from "@/lib/rules/service";
import { versionOnlySchema } from "@/lib/validation/case";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ ruleId: string }> }) => {
    const { ruleId } = await params;
    const found = await loadRuleResource(tx, ruleId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "rule.update", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = versionOnlySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const version = await createNextDraftVersionService(tx, auth, ruleId, parsed.data.version);
      return Response.json(version, { status: 201 });
    } catch (err) {
      if (err instanceof RuleServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: ruleErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
