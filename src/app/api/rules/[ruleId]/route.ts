import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedRuleWhere } from "@/lib/rules/scoping";
import { loadRuleResource } from "@/lib/rules/loadRuleResource";
import { deleteRuleService, RuleServiceError, ruleErrorStatus } from "@/lib/rules/service";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ ruleId: string }> }) => {
    const { ruleId } = await params;
    const rule = await tx.validationRule.findFirst({
      where: { AND: [{ id: ruleId }, scopedRuleWhere(auth)] },
      include: { currentVersion: true },
    });
    if (!rule) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "rule.view", { type: "ValidationRule" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    return Response.json(rule);
  }
);

export const DELETE = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ ruleId: string }> }) => {
    const { ruleId } = await params;
    const found = await loadRuleResource(tx, ruleId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "rule.delete", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    try {
      const result = await deleteRuleService(tx, auth, ruleId);
      return Response.json(result);
    } catch (err) {
      if (err instanceof RuleServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: ruleErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
