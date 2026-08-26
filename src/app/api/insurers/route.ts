import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";

// Non-tenant reference data — no scoping/can() needed, readable by any
// authenticated role. No CRUD routes this phase; hand-seeded via prisma/seed.ts.
export const GET = withAuth(async (_req: NextRequest, _auth, tx) => {
  const insurers = await tx.insurer.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, country: true },
  });
  return Response.json(insurers);
});
