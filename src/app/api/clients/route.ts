import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { createClientService, AccountServiceError } from "@/lib/organizations/service";
import { scopedClientWhere } from "@/lib/organizations/scoping";
import { createClientSchema } from "@/lib/validation/organization";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "client.create", { type: "Client" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const client = await createClientService(tx, auth, parsed.data);
    return Response.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof AccountServiceError) {
      return Response.json({ error: err.code, message: err.message }, { status: 403 });
    }
    throw err;
  }
});

export const GET = withAuth(async (_req: NextRequest, auth, tx) => {
  const clients = await tx.client.findMany({
    where: scopedClientWhere(auth),
    orderBy: { createdAt: "desc" },
    select: { id: true, legalName: true, capabilities: true, status: true, createdAt: true },
  });
  return Response.json(clients);
});
