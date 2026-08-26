import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedRuleWhere } from "@/lib/rules/scoping";
import { createDraftRuleService, RuleServiceError, ruleErrorStatus } from "@/lib/rules/service";
import { createRuleSchema, ruleCategorySchema } from "@/lib/validation/rule";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "rule.create", { type: "ValidationRule" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await createDraftRuleService(tx, auth, parsed.data);
    return Response.json(
      {
        id: result.rule.id,
        scope: result.rule.scope,
        status: result.rule.status,
        currentVersion: result.rule.currentVersion,
        duplicateWarning: result.duplicateWarning,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof RuleServiceError) {
      return Response.json({ error: err.code, message: err.message }, { status: ruleErrorStatus(err.code) });
    }
    throw err;
  }
});

export const GET = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "rule.view", { type: "ValidationRule" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");
  const categoryParam = ruleCategorySchema.safeParse(searchParams.get("category"));
  const status = searchParams.get("status");

  const rules = await tx.validationRule.findMany({
    where: {
      ...scopedRuleWhere(auth),
      scope: scope === "global" || scope === "client" ? scope : undefined,
      category: categoryParam.success ? categoryParam.data : undefined,
      status: status === "draft" || status === "published" || status === "archived" ? status : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { currentVersion: true },
  });
  return Response.json(rules);
});
