import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { createProviderService, AccountServiceError } from "@/lib/organizations/service";
import { scopedProviderWhere } from "@/lib/organizations/scoping";
import { createProviderSchema } from "@/lib/validation/organization";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "provider.create", { type: "Provider" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = createProviderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { provider, duplicateWarning } = await createProviderService(tx, auth, parsed.data);
    return Response.json(
      {
        id: provider.id,
        legalName: provider.legalName,
        mode: provider.mode,
        duplicateWarning,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AccountServiceError) {
      const status =
        err.code === "duplicate_provider"
          ? 409
          : err.code === "probable_duplicate_provider"
            ? 422
            : err.code === "forbidden"
              ? 403
              : 400;
      return Response.json({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
});

export const GET = withAuth(async (_req: NextRequest, auth, tx) => {
  const providers = await tx.provider.findMany({
    where: scopedProviderWhere(auth),
    orderBy: { createdAt: "desc" },
    select: { id: true, legalName: true, mode: true, country: true, status: true, createdAt: true },
  });
  return Response.json(providers);
});
