import { Prisma } from "@/generated/prisma/client";
import { hashProcessingInput, withProcessingJob } from "@/lib/processing/job";
import { normalizeExtractedValue } from "@/lib/processing/normalize";

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** First pattern (in configured order) with a capturing match wins; a miss leaves the field unprocessed rather than inventing "absent" (spec's "never invent" cuts both ways). */
function matchExtractionHint(joinedText: string, patterns: string[]): string | null {
  for (const source of patterns) {
    try {
      const match = new RegExp(source, "i").exec(joinedText);
      if (match?.[1] !== undefined) return match[1].trim();
    } catch {
      // Malformed configured regex — skip it, try the next hint.
    }
  }
  return null;
}

export async function runDeterministicExtraction(
  tx: Prisma.TransactionClient,
  params: {
    caseId: string;
    documentId: string;
    documentVersionId: string;
    schemeVersionId: string;
    confirmedTypeCode: string;
    sourceFileContentHash: string;
    pageTexts: string[];
  }
): Promise<void> {
  const inputVersionHash = hashProcessingInput([params.sourceFileContentHash, "extract", params.confirmedTypeCode]);

  await withProcessingJob(tx, params.documentVersionId, "extract", inputVersionHash, async () => {
    const documentType = await tx.documentTypeDefinition.findFirst({
      where: { schemeVersionId: params.schemeVersionId, code: params.confirmedTypeCode },
      include: { extractionFieldDefinitions: true },
    });
    // No real DocumentTypeDefinition row (e.g. "other_document", or a
    // no-Scheme Case's hardcoded general type) — nothing configured to
    // extract against.
    if (!documentType) return;

    const joinedText = params.pageTexts.filter((t) => t.trim()).join("\n");

    for (const field of documentType.extractionFieldDefinitions) {
      const existing = await tx.extractedField.findUnique({
        where: { documentVersionId_fieldDefinitionId: { documentVersionId: params.documentVersionId, fieldDefinitionId: field.id } },
      });
      // Never overwrite a human-touched value (spec §1/§17).
      if (existing && (existing.status === "confirmed" || existing.status === "corrected")) continue;

      if (!joinedText) {
        await tx.extractedField.upsert({
          where: { documentVersionId_fieldDefinitionId: { documentVersionId: params.documentVersionId, fieldDefinitionId: field.id } },
          create: {
            caseId: params.caseId,
            documentId: params.documentId,
            documentVersionId: params.documentVersionId,
            fieldDefinitionId: field.id,
            valueType: field.valueType,
            status: "unreadable",
            extractionMethod: "embedded_text",
          },
          update: { status: "unreadable", extractionMethod: "embedded_text", rawValue: null, normalizedValue: Prisma.JsonNull },
        });
        continue;
      }

      const rawValue = matchExtractionHint(joinedText, asStringArray(field.extractionHints));
      if (rawValue === null) continue;

      const { normalizedValue, ok } = normalizeExtractedValue(rawValue, field.valueType);

      await tx.extractedField.upsert({
        where: { documentVersionId_fieldDefinitionId: { documentVersionId: params.documentVersionId, fieldDefinitionId: field.id } },
        create: {
          caseId: params.caseId,
          documentId: params.documentId,
          documentVersionId: params.documentVersionId,
          fieldDefinitionId: field.id,
          rawValue,
          normalizedValue: normalizedValue === null ? Prisma.JsonNull : normalizedValue,
          valueType: field.valueType,
          status: ok ? "extracted" : "invalid",
          extractionMethod: "deterministic_parser",
        },
        update: {
          rawValue,
          normalizedValue: normalizedValue === null ? Prisma.JsonNull : normalizedValue,
          status: ok ? "extracted" : "invalid",
          extractionMethod: "deterministic_parser",
        },
      });
    }
  });
}
