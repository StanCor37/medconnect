import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedSchemeWhere } from "@/lib/rules/scoping";
import { createDraftSchemeService, SchemeServiceError, schemeErrorStatus } from "@/lib/schemes/service";
import { createSchemeSchema } from "@/lib/validation/scheme";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "scheme.create", { type: "ValidationScheme" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = createSchemeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const scheme = await createDraftSchemeService(tx, auth, parsed.data);
    return Response.json(scheme, { status: 201 });
  } catch (err) {
    if (err instanceof SchemeServiceError) {
      return Response.json({ error: err.code, message: err.message }, { status: schemeErrorStatus(err.code) });
    }
    throw err;
  }
});

export const GET = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "scheme.view", { type: "ValidationScheme" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");
  const status = searchParams.get("status");

  const schemes = await tx.validationScheme.findMany({
    where: {
      ...scopedSchemeWhere(auth),
      scope: scope === "global" || scope === "client" ? scope : undefined,
      status: status === "draft" || status === "published" || status === "archived" ? status : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { currentVersion: true },
  });
  return Response.json(schemes);
});
