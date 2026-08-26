import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { deleteAccountService, AccountServiceError } from "@/lib/accounts/service";
import { loadUserResource } from "@/lib/accounts/loadUserResource";

export const GET = withAuth(async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ userId: string }> }) => {
  const { userId } = await params;
  const found = await loadUserResource(tx, auth, userId);
  if (!found) return Response.json({ error: "not_found" }, { status: 404 });

  const decision = can(auth, "user.view", found.resource);
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  return Response.json({
    id: found.user.id,
    email: found.user.email,
    role: found.user.role,
    status: found.user.status,
    firstName: found.user.firstName,
    lastName: found.user.lastName,
    providerId: found.user.providerId,
    clientId: found.user.clientId,
    createdAt: found.user.createdAt,
    updatedAt: found.user.updatedAt,
  });
});

export const DELETE = withAuth(async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ userId: string }> }) => {
  const { userId } = await params;
  const found = await loadUserResource(tx, auth, userId);
  if (!found) return Response.json({ error: "not_found" }, { status: 404 });

  const decision = can(auth, "user.delete", found.resource);
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  try {
    const result = await deleteAccountService(tx, auth, userId);
    return Response.json(result);
  } catch (err) {
    if (err instanceof AccountServiceError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    throw err;
  }
});
