import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/lib/authz/can";

/**
 * App-layer row scoping for list/collection queries — mirrors the RLS
 * policies in prisma/rls.sql exactly. This is NOT redundant with RLS: with
 * the current single owner-level DATABASE_URL, Postgres table ownership
 * bypasses RLS entirely (see the "DB role note" in the foundation plan), so
 * these `where` clauses are the only enforcement collection endpoints get
 * today. Keep both in sync — RLS becomes the real backstop once a
 * non-owner `medconnect_app` role is introduced.
 */
export function scopedProviderWhere(auth: AuthContext): Prisma.ProviderWhereInput {
  if (auth.role === "super_admin") {
    return { mode: "standalone" };
  }
  if (auth.role === "client_admin") {
    return {
      relationships: { some: { clientId: auth.clientId!, status: "active" } },
    };
  }
  // provider_user
  return { id: auth.providerId! };
}

export function scopedClientWhere(auth: AuthContext): Prisma.ClientWhereInput {
  if (auth.role === "super_admin") {
    return {};
  }
  if (auth.role === "client_admin") {
    return { id: auth.clientId! };
  }
  // provider_user: any relationship regardless of status (Connections screen)
  return {
    relationships: { some: { providerId: auth.providerId! } },
  };
}

export function scopedRelationshipWhere(
  auth: AuthContext
): Prisma.ProviderClientRelationshipWhereInput {
  if (auth.role === "super_admin") {
    return {};
  }
  if (auth.role === "client_admin") {
    return { clientId: auth.clientId! };
  }
  // provider_user
  return { providerId: auth.providerId! };
}

/**
 * Mirrors the RLS `user_select_*` policies. This is the actual authorization
 * boundary for "can this actor even see this User row" — every accounts
 * route must fetch through this (see loadUserResource), never a bare
 * findUnique by id, for the same reason as the other scoped* helpers above.
 */
export function scopedUserWhere(auth: AuthContext): Prisma.UserWhereInput {
  if (auth.role === "super_admin") {
    return {
      OR: [
        { role: { in: ["super_admin", "client_admin"] } },
        { role: "provider_user", provider: { mode: "standalone" } },
      ],
    };
  }
  if (auth.role === "client_admin") {
    return {
      OR: [
        { clientId: auth.clientId! },
        {
          provider: {
            relationships: { some: { clientId: auth.clientId!, status: "active" } },
          },
        },
      ],
    };
  }
  // provider_user: colleagues within the same Provider
  return { providerId: auth.providerId! };
}
