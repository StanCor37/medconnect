import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { scopedClientWhere } from "@/lib/organizations/scoping";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ clientId: string }> }) => {
    const { clientId } = await params;

    // AND (not a naive spread) — scopedClientWhere can itself return an `id`
    // filter (the client_admin case), which would silently clobber the route
    // param's id under a plain object spread.
    const client = await tx.client.findFirst({
      where: { AND: [{ id: clientId }, scopedClientWhere(auth)] },
    });
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json(client);
  }
);
