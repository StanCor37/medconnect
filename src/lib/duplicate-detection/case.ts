import type { Prisma } from "@/generated/prisma/client";
import type { ExternalReferenceSource } from "@/generated/prisma/enums";

export interface CaseDuplicateInput {
  providerId: string;
  clientId: string | null;
  externalReferenceSource: ExternalReferenceSource | null;
  externalReference: string | null;
  patientReference: string | null;
  eventDate: Date | null;
  serviceType: string | null;
}

export type CaseDuplicateResult =
  | { kind: "exact_match"; caseId: string }
  | { kind: "probable_match"; candidates: { caseId: string; internalReference: string }[] }
  | { kind: "no_match" };

/**
 * Segment 4 §17: exact scoped-external-reference matches BLOCK creation;
 * probable matches (same patient reference + date + service type, same
 * Provider) WARN and require confirmedNotDuplicateBy to proceed.
 *
 * The exact-match check exists in the app layer *in addition to* the DB
 * unique constraint specifically because Postgres never treats two NULLs as
 * equal for uniqueness — two standalone Cases (both clientId = null) with
 * the same external reference would NOT collide on the DB constraint, but
 * Prisma compiles `clientId: null` to `"clientId" IS NULL`, which correctly
 * catches this case here. The DB constraint remains the real race-condition
 * backstop for the client-connected case.
 */
export async function checkForDuplicateCase(
  tx: Prisma.TransactionClient,
  input: CaseDuplicateInput,
  excludeCaseId?: string
): Promise<CaseDuplicateResult> {
  if (input.externalReference && input.externalReferenceSource) {
    const match = await tx.case.findFirst({
      where: {
        id: excludeCaseId ? { not: excludeCaseId } : undefined,
        providerId: input.providerId,
        clientId: input.clientId,
        externalReferenceSource: input.externalReferenceSource,
        externalReference: input.externalReference,
      },
      select: { id: true },
    });
    if (match) return { kind: "exact_match", caseId: match.id };
  }

  if (input.patientReference && input.eventDate && input.serviceType) {
    const candidates = await tx.case.findMany({
      where: {
        id: excludeCaseId ? { not: excludeCaseId } : undefined,
        providerId: input.providerId, // scoped to Provider — a warning can never reveal a Case outside the actor's own Provider
        patientReference: input.patientReference,
        eventDate: input.eventDate,
        serviceType: input.serviceType,
      },
      select: { id: true, internalReference: true },
      take: 5,
    });
    if (candidates.length > 0) {
      return {
        kind: "probable_match",
        candidates: candidates.map((c) => ({ caseId: c.id, internalReference: c.internalReference })),
      };
    }
  }

  return { kind: "no_match" };
}
