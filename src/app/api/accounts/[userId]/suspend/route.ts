import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { setAccountStatus, AccountServiceError } from "@/lib/accounts/service";
import { loadUserResource } from "@/lib/accounts/loadUserResource";

export const POST = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ userId: string }> }) => {
    const { userId } = await params;
    const found = await loadUserResource(tx, auth, userId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "user.suspend", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    try {
      const target = await setAccountStatus(tx, auth, userId, "suspend");
      return Response.json({ id: target.id, status: target.status });
    } catch (err) {
      if (err instanceof AccountServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: 400 });
      }
      throw err;
    }
  }
);
