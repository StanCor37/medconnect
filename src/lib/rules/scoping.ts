import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";

/**
 * Mirrors the ValidationRule RLS policies exactly (prisma/rls.sql). This IS
 * the authorization boundary today (RLS is dormant under the owner-level
 * DATABASE_URL — see README) — Super Admin gets real governance visibility
 * into Client-owned rows here (unlike Case, which gives Super Admin zero
 * access), matching spec Segment 3 §2-3.
 */
export function scopedRuleWhere(auth: AuthContext): Prisma.ValidationRuleWhereInput {
  if (auth.role === "super_admin") {
    return {}; // full control of global rows + read-only governance into client-owned rows (can() gates the write side)
  }
  if (auth.role === "client_admin") {
    return {
      OR: [
        { scope: "global", status: "published" },
        { scope: "client", clientId: auth.clientId! },
      ],
    };
  }
  // provider_user
  return {
    status: "published",
    OR: [
      { scope: "global" },
      {
        scope: "client",
        client: { relationships: { some: { providerId: auth.providerId!, status: "active" } } },
      },
    ],
  };
}

/** Mirrors the ValidationScheme RLS policies exactly — identical shape to scopedRuleWhere. */
export function scopedSchemeWhere(auth: AuthContext): Prisma.ValidationSchemeWhereInput {
  if (auth.role === "super_admin") {
    return {};
  }
  if (auth.role === "client_admin") {
    return {
      OR: [
        { scope: "global", status: "published" },
        { scope: "client", clientId: auth.clientId! },
      ],
    };
  }
  return {
    status: "published",
    OR: [
      { scope: "global" },
      {
        scope: "client",
        client: { relationships: { some: { providerId: auth.providerId!, status: "active" } } },
      },
    ],
  };
}
