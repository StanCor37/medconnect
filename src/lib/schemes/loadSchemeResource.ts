import type { Prisma } from "@/generated/prisma/client";
import type { ResourceRef } from "@/lib/authz/can";

export async function loadSchemeResource(
  tx: Prisma.TransactionClient,
  schemeId: string
): Promise<{ scheme: Prisma.ValidationSchemeGetPayload<object>; resource: ResourceRef } | null> {
  const scheme = await tx.validationScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) return null;
  return {
    scheme,
    resource: { type: "ValidationScheme", id: scheme.id, scope: scheme.scope, clientId: scheme.clientId },
  };
}
