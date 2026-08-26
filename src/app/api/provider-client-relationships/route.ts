import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { createRelationshipService, AccountServiceError } from "@/lib/organizations/service";
import { scopedRelationshipWhere } from "@/lib/organizations/scoping";
import { createRelationshipSchema } from "@/lib/validation/organization";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "relationship.create", { type: "ProviderClientRelationship" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = createRelationshipSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const relationship = await createRelationshipService(tx, auth, parsed.data.providerId);
    return Response.json(relationship, { status: 201 });
  } catch (err) {
    if (err instanceof AccountServiceError) {
      const status = err.code === "not_found" ? 404 : err.code === "relationship_exists" ? 409 : 403;
      return Response.json({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
});

export const GET = withAuth(async (_req: NextRequest, auth, tx) => {
  const relationships = await tx.providerClientRelationship.findMany({
    where: scopedRelationshipWhere(auth),
    orderBy: { createdAt: "desc" },
  });
  return Response.json(relationships);
});
