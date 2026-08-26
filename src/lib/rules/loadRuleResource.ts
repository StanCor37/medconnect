import type { Prisma } from "@/generated/prisma/client";
import type { ResourceRef } from "@/lib/authz/can";

export async function loadRuleResource(
  tx: Prisma.TransactionClient,
  ruleId: string
): Promise<{ rule: Prisma.ValidationRuleGetPayload<object>; resource: ResourceRef } | null> {
  const rule = await tx.validationRule.findUnique({ where: { id: ruleId } });
  if (!rule) return null;
  return {
    rule,
    resource: { type: "ValidationRule", id: rule.id, scope: rule.scope, clientId: rule.clientId },
  };
}
