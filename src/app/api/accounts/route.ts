import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { createAccountService, AccountServiceError } from "@/lib/accounts/service";
import { scopedUserWhere } from "@/lib/organizations/scoping";
import { createAccountSchema } from "@/lib/validation/account";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "user.create", { type: "User" });
  if (!decision.allowed) {
    return Response.json({ error: "forbidden" }, { status: decision.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const loginUrl = new URL("/login", req.url).toString();

  try {
    const result = await createAccountService(tx, auth, parsed.data, loginUrl);
    return Response.json(
      {
        userId: result.userId,
        // Dev-only convenience: with EMAIL_PROVIDER=console there is no real
        // email, so the temp password is echoed here for local testing. This
        // MUST be removed once a real EmailProvider is wired up in production.
        devTempPassword:
          process.env.EMAIL_PROVIDER !== "resend" ? result.tempPasswordForDevRelay : undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AccountServiceError) {
      const status = err.code === "not_found" ? 404 : err.code === "forbidden" ? 403 : 409;
      return Response.json({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
});

export const GET = withAuth(async (_req: NextRequest, auth, tx) => {
  const decision = can(auth, "user.view", { type: "User" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const users = await tx.user.findMany({
    where: scopedUserWhere(auth),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      firstName: true,
      lastName: true,
      providerId: true,
      clientId: true,
      createdAt: true,
      updatedAt: true,
      provider: { select: { legalName: true } },
      client: { select: { legalName: true } },
    },
  });
  return Response.json(users);
});
