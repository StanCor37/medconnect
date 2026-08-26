import type { Prisma } from "@/generated/prisma/client";

export function normalizeProviderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics (after NFKD decomposition)
    .replace(/[^\p{L}\p{N}\s]/gu, "") // strip remaining punctuation
    .replace(/\s+/g, " ");
}

export interface ProviderDuplicateInput {
  country: string;
  officialRegistrationNumber?: string | null;
  taxId?: string | null;
  legalName: string;
  addressLine?: string | null;
  city?: string | null;
}

export type ProviderDuplicateResult =
  | { kind: "exact_match"; providerId: string; reason: "registration_number" | "tax_id" }
  | { kind: "probable_match"; candidates: { providerId: string; legalName: string }[] }
  | { kind: "no_match" };

/**
 * Segment 2 §10: exact official-identifier matches BLOCK creation; probable
 * name/address matches WARN and require an explicit confirmedNotDuplicateBy
 * actor before creation proceeds. Never auto-merge.
 */
export async function checkForDuplicateProvider(
  tx: Prisma.TransactionClient,
  input: ProviderDuplicateInput
): Promise<ProviderDuplicateResult> {
  if (input.officialRegistrationNumber) {
    const match = await tx.provider.findFirst({
      where: {
        country: input.country,
        officialRegistrationNumber: input.officialRegistrationNumber,
      },
    });
    if (match) {
      return { kind: "exact_match", providerId: match.id, reason: "registration_number" };
    }
  }

  if (input.taxId) {
    const match = await tx.provider.findFirst({
      where: { country: input.country, taxId: input.taxId },
    });
    if (match) {
      return { kind: "exact_match", providerId: match.id, reason: "tax_id" };
    }
  }

  const normalizedName = normalizeProviderName(input.legalName);
  const candidates = await tx.provider.findMany({
    where: {
      country: input.country,
      normalizedName: { contains: normalizedName },
    },
    select: { id: true, legalName: true },
    take: 5,
  });

  if (candidates.length > 0) {
    return {
      kind: "probable_match",
      candidates: candidates.map((c) => ({ providerId: c.id, legalName: c.legalName })),
    };
  }

  return { kind: "no_match" };
}
