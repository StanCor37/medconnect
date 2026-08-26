import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedCaseWhere } from "@/lib/cases/scoping";
import { createCaseService, caseErrorStatus, CaseServiceError } from "@/lib/cases/service";
import { hashRequestBody } from "@/lib/cases/idempotency";
import { createCaseSchema } from "@/lib/validation/case";

export const POST = withAuth(async (req: NextRequest, auth, tx) => {
  const decision = can(auth, "case.create", { type: "Case" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const body = await req.json().catch(() => null);
  const parsed = createCaseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const idempotencyKeyHeader = req.headers.get("Idempotency-Key");
  const idempotency = idempotencyKeyHeader
    ? { key: idempotencyKeyHeader, requestHash: hashRequestBody(parsed.data) }
    : undefined;

  try {
    const result = await createCaseService(tx, auth, parsed.data, idempotency);
    return Response.json(
      {
        id: result.case.id,
        internalReference: result.case.internalReference,
        caseMode: result.case.caseMode,
        status: result.case.status,
        version: result.case.version,
        duplicateWarning: result.duplicateWarning,
      },
      { status: result.replayed ? 200 : 201 }
    );
  } catch (err) {
    if (err instanceof CaseServiceError) {
      return Response.json({ error: err.code, message: err.message }, { status: caseErrorStatus(err.code) });
    }
    throw err;
  }
});

export const GET = withAuth(async (_req: NextRequest, auth, tx) => {
  const decision = can(auth, "case.view", { type: "Case" });
  if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

  const cases = await tx.case.findMany({
    where: { ...scopedCaseWhere(auth), archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      internalReference: true,
      caseMode: true,
      status: true,
      providerId: true,
      clientId: true,
      patientReference: true,
      serviceType: true,
      eventDate: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return Response.json(cases);
});
