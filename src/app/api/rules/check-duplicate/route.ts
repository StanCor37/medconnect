import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { checkForDuplicateRule } from "@/lib/duplicate-detection/rule";
import { checkDuplicateRuleSchema } from "@/lib/validation/rule";

/** Pre-flight, no side effects — backs a live "is this a duplicate?" UI check before create. */
export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "rule.create", { type: "ValidationRule" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = checkDuplicateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const clientId = auth.role === "client_admin" ? auth.clientId! : null;
  const result = await checkForDuplicateRule(tx, {
    clientId,
    category: parsed.data.category,
    executionType: parsed.data.executionType,
    name: parsed.data.name,
    definition: parsed.data.definition,
  });
  return Response.json(result);
});
