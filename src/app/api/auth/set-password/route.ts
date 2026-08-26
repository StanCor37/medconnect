import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setPasswordService, AccountServiceError } from "@/lib/accounts/service";
import { setPasswordSchema } from "@/lib/validation/account";

/**
 * Pre-authentication route (first login) — see the note in
 * src/app/api/auth/login/route.ts about running on the bare `prisma` client.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = setPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email, tempPassword, newPassword } = parsed.data;

  try {
    const result = await prisma.$transaction((tx) =>
      setPasswordService(tx, email, tempPassword, newPassword)
    );
    return Response.json({ userId: result.userId });
  } catch (err) {
    if (err instanceof AccountServiceError) {
      const status = err.code === "invalid_credentials" ? 401 : 400;
      return Response.json({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
}
