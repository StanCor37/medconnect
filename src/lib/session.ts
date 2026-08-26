import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";
import { prisma } from "@/lib/db";

interface SessionCookiePayload {
  sessionId?: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sessionOptions() {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters"
    );
  }
  return {
    cookieName: "medconnect_session",
    password,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

async function getCookieSession(): Promise<IronSession<SessionCookiePayload>> {
  return getIronSession<SessionCookiePayload>(await cookies(), sessionOptions());
}

export interface AuthenticatedUser {
  id: string;
  role: "super_admin" | "client_admin" | "provider_user";
  status: "invited" | "active" | "suspended" | "deactivated";
  providerId: string | null;
  clientId: string | null;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Creates a new DB-backed Session row and points the encrypted cookie at it.
 * Cookie payload is intentionally minimal (just the session id) — live
 * account status is re-checked against the database on every request via
 * `getCurrentUser`, which is what lets suspend/deactivate take effect
 * immediately instead of waiting for a JWT to expire.
 */
export async function createSession(userId: string, userAgent: string | null) {
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      userAgent: userAgent ?? undefined,
    },
  });

  const cookieSession = await getCookieSession();
  cookieSession.sessionId = session.id;
  await cookieSession.save();

  return session;
}

export async function destroyCurrentSession() {
  const cookieSession = await getCookieSession();
  if (cookieSession.sessionId) {
    await prisma.session
      .update({
        where: { id: cookieSession.sessionId },
        data: { revokedAt: new Date() },
      })
      .catch(() => {
        // session row already gone/revoked — nothing to do
      });
  }
  cookieSession.destroy();
}

/**
 * Resolves the current request's authenticated user, re-validating the
 * session and account status against the database. Returns null for no
 * session, an expired/revoked session, or a nonexistent user — callers
 * decide whether that means 401.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieSession = await getCookieSession();
  const sessionId = cookieSession.sessionId;
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }

  const user = session.user;
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    providerId: user.providerId,
    clientId: user.clientId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}
