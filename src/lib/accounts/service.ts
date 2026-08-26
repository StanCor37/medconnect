import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateTempPassword, tempPasswordExpiresAt } from "@/lib/auth/tempPassword";
import { normalizeEmail, findExistingUserByEmail } from "@/lib/duplicate-detection/user";
import { writeAuditEvent } from "@/lib/audit/record";
import { getEmailProvider } from "@/lib/email/sendMail";
import { revokeAllSessionsForUser } from "@/lib/auth/sessionStore";
import type { CreateAccountInput } from "@/lib/validation/account";

export class AccountServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Validates the business rule for *who* may create *what kind* of account —
 * distinct from the coarse role gate in `can()`. Throws AccountServiceError
 * on any violation; the route handler maps that to an HTTP status.
 */
async function assertCanCreateAccountFor(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateAccountInput
) {
  if (input.role === "client_admin") {
    if (actor.role !== "super_admin") {
      throw new AccountServiceError("forbidden", "Only Super Admin can create Client Admins");
    }
    if (!input.clientId) {
      throw new AccountServiceError("invalid_input", "clientId is required for a Client Admin");
    }
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw new AccountServiceError("not_found", "Client not found");
    return;
  }

  // role === "provider_user"
  if (!input.providerId) {
    throw new AccountServiceError("invalid_input", "providerId is required for a Provider User");
  }
  const provider = await tx.provider.findUnique({ where: { id: input.providerId } });
  if (!provider) throw new AccountServiceError("not_found", "Provider not found");

  if (actor.role === "super_admin") {
    if (provider.mode !== "standalone" || provider.createdBySuperAdminId == null) {
      throw new AccountServiceError(
        "forbidden",
        "Super Admin may only create Provider Users for standalone Providers they created"
      );
    }
    return;
  }

  if (actor.role === "client_admin") {
    const relationship = await tx.providerClientRelationship.findUnique({
      where: { providerId_clientId: { providerId: input.providerId, clientId: actor.clientId! } },
    });
    if (!relationship || relationship.status !== "active") {
      throw new AccountServiceError(
        "forbidden",
        "Client Admin may only create Provider Users for Providers with an active relationship to their Client"
      );
    }
    return;
  }

  throw new AccountServiceError("forbidden", "Provider Users cannot create accounts");
}

export interface CreateAccountResult {
  userId: string;
  /** dev-only convenience — never returned by the API response, only used for local testing relay */
  tempPasswordForDevRelay?: string;
}

export async function createAccountService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: CreateAccountInput,
  loginUrl: string
): Promise<CreateAccountResult> {
  await assertCanCreateAccountFor(tx, actor, input);

  const normalizedEmail = normalizeEmail(input.email);
  const existing = await findExistingUserByEmail(tx, normalizedEmail);
  if (existing.kind !== "none") {
    throw new AccountServiceError(
      `email_${existing.kind}`,
      `An account for this email already exists (${existing.kind}). Use the connection/resend/restore flow instead of creating a new one.`
    );
  }

  const user = await tx.user.create({
    data: {
      email: normalizedEmail,
      role: input.role,
      status: "invited",
      firstName: input.firstName,
      lastName: input.lastName,
      providerId: input.role === "provider_user" ? input.providerId : null,
      clientId: input.role === "client_admin" ? input.clientId : null,
      createdByUserId: actor.userId,
    },
  });

  const tempPassword = generateTempPassword();
  await tx.invitation.create({
    data: {
      userId: user.id,
      status: "pending",
      tempPasswordHash: await hashPassword(tempPassword),
      tempPasswordExpiresAt: tempPasswordExpiresAt(),
      invitedByUserId: actor.userId,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "user_invited",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: user.providerId,
    clientId: user.clientId,
    targetType: "User",
    targetId: user.id,
    action: "invite",
    source: "api",
  });

  await getEmailProvider().sendInvitationEmail({
    toEmail: normalizedEmail,
    firstName: user.firstName,
    tempPassword,
    loginUrl,
  });

  return { userId: user.id, tempPasswordForDevRelay: tempPassword };
}

export interface SetPasswordResult {
  userId: string;
}

/**
 * First-login flow: verify the temp password from the pending Invitation
 * (never User.passwordHash, which is still null), set a permanent password,
 * activate the account.
 */
export async function setPasswordService(
  tx: Prisma.TransactionClient,
  email: string,
  tempPassword: string,
  newPassword: string
): Promise<SetPasswordResult> {
  const normalizedEmail = normalizeEmail(email);
  const user = await tx.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new AccountServiceError("invalid_credentials", "Invalid email or temporary password");

  const invitation = await tx.invitation.findFirst({
    where: { userId: user.id, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  if (!invitation) {
    throw new AccountServiceError("invalid_credentials", "Invalid email or temporary password");
  }
  if (invitation.tempPasswordExpiresAt < new Date()) {
    throw new AccountServiceError("expired_invitation", "This invitation has expired. Ask an admin to resend it.");
  }
  const valid = await verifyPassword(tempPassword, invitation.tempPasswordHash);
  if (!valid) {
    throw new AccountServiceError("invalid_credentials", "Invalid email or temporary password");
  }

  await tx.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), status: "active" },
  });
  await tx.invitation.update({
    where: { id: invitation.id },
    data: { status: "accepted", usedAt: new Date() },
  });

  await writeAuditEvent(tx, {
    eventType: "user_activated",
    actorUserId: user.id,
    actorRole: user.role,
    providerId: user.providerId,
    clientId: user.clientId,
    targetType: "User",
    targetId: user.id,
    action: "activate",
    source: "api",
  });

  return { userId: user.id };
}

export async function verifyLoginPassword(
  tx: Prisma.TransactionClient,
  email: string,
  password: string
) {
  const normalizedEmail = normalizeEmail(email);
  const user = await tx.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.passwordHash) return null;
  if (user.status !== "active") return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;
  return user;
}

type SuspendKind = "suspend" | "deactivate";

export async function setAccountStatus(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  targetUserId: string,
  kind: SuspendKind
) {
  const target = await tx.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AccountServiceError("not_found", "Account not found");

  const now = new Date();
  const updated = await tx.user.update({
    where: { id: target.id },
    data:
      kind === "suspend"
        ? { status: "suspended", suspendedAt: now }
        : { status: "deactivated", deactivatedAt: now },
  });

  await revokeAllSessionsForUser(tx, target.id);

  await writeAuditEvent(tx, {
    eventType: kind === "suspend" ? "user_suspended" : "user_deactivated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: target.providerId,
    clientId: target.clientId,
    targetType: "User",
    targetId: target.id,
    action: kind,
    source: "api",
  });

  return updated;
}

export interface DeleteAccountResult {
  hardDeleted: boolean;
}

/**
 * Hard-deletes only accounts that never activated and have zero
 * audit-relevant activity beyond the invite itself (Segment 2 §8). Otherwise
 * falls back to deactivation, per the spec's explicit wording, and audits
 * the fallback so it's visible that a delete request became a deactivation.
 */
export async function deleteAccountService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  targetUserId: string
): Promise<DeleteAccountResult> {
  const target = await tx.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AccountServiceError("not_found", "Account not found");

  const activityCount = await tx.auditEvent.count({
    where: {
      targetType: "User",
      targetId: target.id,
      eventType: { notIn: ["user_invited"] },
    },
  });

  const eligibleForHardDelete = target.status === "invited" && activityCount === 0;

  if (eligibleForHardDelete) {
    await tx.invitation.deleteMany({ where: { userId: target.id } });
    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.user.delete({ where: { id: target.id } });
    await writeAuditEvent(tx, {
      eventType: "user_deleted",
      actorUserId: actor.userId,
      actorRole: actor.role,
      providerId: target.providerId,
      clientId: target.clientId,
      targetType: "User",
      targetId: target.id,
      action: "hard_delete",
      source: "api",
    });
    return { hardDeleted: true };
  }

  await setAccountStatus(tx, actor, targetUserId, "deactivate");
  await writeAuditEvent(tx, {
    eventType: "user_deactivated",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: target.providerId,
    clientId: target.clientId,
    targetType: "User",
    targetId: target.id,
    action: "delete_fallback_to_deactivate",
    source: "api",
    reasonCode: "has_activity_or_already_active",
  });
  return { hardDeleted: false };
}

export async function resendInviteService(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  targetUserId: string,
  loginUrl: string
) {
  const target = await tx.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AccountServiceError("not_found", "Account not found");
  if (target.status !== "invited") {
    throw new AccountServiceError("invalid_state", "Only invited (not yet activated) accounts can be re-invited");
  }

  await tx.invitation.updateMany({
    where: { userId: target.id, status: "pending" },
    data: { status: "revoked", revokedAt: new Date() },
  });

  const tempPassword = generateTempPassword();
  await tx.invitation.create({
    data: {
      userId: target.id,
      status: "pending",
      tempPasswordHash: await hashPassword(tempPassword),
      tempPasswordExpiresAt: tempPasswordExpiresAt(),
      invitedByUserId: actor.userId,
    },
  });

  await writeAuditEvent(tx, {
    eventType: "user_invited",
    actorUserId: actor.userId,
    actorRole: actor.role,
    providerId: target.providerId,
    clientId: target.clientId,
    targetType: "User",
    targetId: target.id,
    action: "resend_invite",
    source: "api",
    reasonCode: "resend",
  });

  await getEmailProvider().sendInvitationEmail({
    toEmail: target.email,
    firstName: target.firstName,
    tempPassword,
    loginUrl,
  });

  return { tempPasswordForDevRelay: tempPassword };
}
