import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Bare client — never use this directly for tenant-scoped queries. It has no
// RLS session context set, so on a real (non-owner) DB role every RLS-guarded
// table would return zero rows. Use `withRls()` below for anything that reads
// or writes User/Provider/Client/ProviderClientRelationship/AuditEvent/etc.
export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export interface RlsContext {
  userId: string;
  role: "super_admin" | "client_admin" | "provider_user";
  providerId: string | null;
  clientId: string | null;
}

/**
 * Runs `fn` inside a single Postgres transaction with `app.user_id`,
 * `app.role`, `app.provider_id` and `app.client_id` session variables set via
 * `set_config(..., true)` (transaction-local). Every RLS policy in
 * prisma/migrations/**\/migration.sql reads these via `current_setting(...)`.
 *
 * `set_config`'s third argument (`is_local = true`) scopes the setting to the
 * current transaction, so it can never leak across pooled connections between
 * unrelated requests — this is what makes the pattern safe with PgBouncer
 * transaction-mode pooling (e.g. Neon's pooled connection string).
 *
 * Every tenant-scoped read/write must go through this helper instead of the
 * bare `prisma` client above — that's what makes RLS the real, defense-in-depth
 * boundary rather than a policy set nobody actually exercises.
 */
export async function withRls<T>(
  ctx: RlsContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.role', $2, true),
              set_config('app.provider_id', $3, true),
              set_config('app.client_id', $4, true)`,
      ctx.userId,
      ctx.role,
      ctx.providerId ?? "",
      ctx.clientId ?? ""
    );
    return fn(tx);
  });
}
