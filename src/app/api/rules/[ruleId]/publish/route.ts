import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { loadRuleResource } from "@/lib/rules/loadRuleResource";
import { publishRuleVersionService, RuleServiceError, ruleErrorStatus } from "@/lib/rules/service";
import { publishRuleSchema } from "@/lib/validation/rule";

export const POST = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ ruleId: string }> }) => {
    const { ruleId } = await params;
    const found = await loadRuleResource(tx, ruleId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "rule.publish", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    const body = await req.json().catch(() => null);
    const parsed = publishRuleSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
    }

    try {
      const updated = await publishRuleVersionService(tx, auth, ruleId, parsed.data.versionId, parsed.data.version);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof RuleServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: ruleErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
