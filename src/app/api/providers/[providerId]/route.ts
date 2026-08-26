import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { scopedProviderWhere } from "@/lib/organizations/scoping";

export const GET = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ providerId: string }> }) => {
    const { providerId } = await params;

    // scopedProviderWhere IS the authorization boundary here (mirrors the RLS
    // provider_select_* policies) — a plain findUnique-by-id would return the
    // row regardless of visibility, since RLS isn't independently enforced
    // yet under the current owner-level DB connection (see README).
    // AND (not a naive spread) — scopedProviderWhere can itself return an
    // `id` filter (the provider_user case), which would silently clobber the
    // route param's id under a plain object spread.
    const provider = await tx.provider.findFirst({
      where: { AND: [{ id: providerId }, scopedProviderWhere(auth)] },
    });
    if (!provider) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json(provider);
  }
);
