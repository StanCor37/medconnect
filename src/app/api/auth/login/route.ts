import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import { verifyLoginPassword } from "@/lib/accounts/service";
import { writeAuditEvent } from "@/lib/audit/record";
import { loginSchema } from "@/lib/validation/account";

/**
 * Pre-authentication route — runs on the bare `prisma` client, not
 * `withRls`, because there is no session context yet to set. This is safe
 * only because the app currently connects as the DB owner role, which
 * bypasses RLS entirely (see the "DB role note" in the foundation plan).
 * Once a restricted `medconnect_app` role is introduced, this lookup will
 * need its own narrow RLS policy (or a SECURITY DEFINER function) — flagged
 * in the README as a pre-production TODO, not forgotten.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await prisma.$transaction(async (tx) => {
    const verified = await verifyLoginPassword(tx, email, password);
    if (!verified) {
      // Generic message — do not reveal whether the email exists (Segment 11 §15).
      await writeAuditEvent(tx, {
        eventType: "login_failed",
        actorUserId: null,
        actorRole: null,
        targetType: "User",
        targetId: email,
        action: "login",
        source: "api",
      });
      return null;
    }
    await writeAuditEvent(tx, {
      eventType: "login_succeeded",
      actorUserId: verified.id,
      actorRole: verified.role,
      providerId: verified.providerId,
      clientId: verified.clientId,
      targetType: "User",
      targetId: verified.id,
      action: "login",
      source: "api",
    });
    return verified;
  });

  if (!user) {
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await createSession(user.id, req.headers.get("user-agent"));

  return Response.json({
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
  });
}
