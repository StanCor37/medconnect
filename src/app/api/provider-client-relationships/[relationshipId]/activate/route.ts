import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { activateRelationshipService, AccountServiceError } from "@/lib/organizations/service";

export const POST = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ relationshipId: string }> }) => {
    const { relationshipId } = await params;
    const relationship = await tx.providerClientRelationship.findUnique({ where: { id: relationshipId } });
    if (!relationship) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "relationship.activate", {
      type: "ProviderClientRelationship",
      providerId: relationship.providerId,
      clientId: relationship.clientId,
    });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    try {
      const updated = await activateRelationshipService(tx, auth, relationshipId);
      return Response.json(updated);
    } catch (err) {
      if (err instanceof AccountServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: 400 });
      }
      throw err;
    }
  }
);
