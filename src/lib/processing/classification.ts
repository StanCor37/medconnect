import type { Prisma } from "@/generated/prisma/client";
import type { ClassificationMethod } from "@/generated/prisma/enums";
import { hashProcessingInput, withProcessingJob } from "@/lib/processing/job";

const AUTO_SUGGEST_MIN = 0.6;

interface ClassificationHints {
  filenameKeywords?: string[];
  textKeywords?: string[];
}

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

function parseClassificationHints(json: Prisma.JsonValue): ClassificationHints {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const obj = json as Record<string, unknown>;
  return { filenameKeywords: asStringArray(obj.filenameKeywords), textKeywords: asStringArray(obj.textKeywords) };
}

function scoreKeywords(haystack: string, keywords: string[] | undefined): number {
  if (!keywords || keywords.length === 0) return 0;
  const lowerHaystack = haystack.toLowerCase();
  const matched = keywords.filter((k) => lowerHaystack.includes(k.toLowerCase())).length;
  return matched / keywords.length;
}

interface Candidate {
  documentTypeCode: string;
  confidence: number;
  method: ClassificationMethod;
}

/**
 * Text signal always wins over filename when a type configures both,
 * matching spec §5's ordering (deterministic_text step 4 outranks filename
 * step 3) — even a zero-match text score is preferred over a filename
 * fallback for that type, since the type explicitly opted into text-based
 * classification.
 */
function scoreDocumentType(
  code: string,
  hints: ClassificationHints,
  originalFilename: string,
  joinedText: string
): Candidate | null {
  if (hints.textKeywords && joinedText) {
    return { documentTypeCode: code, confidence: scoreKeywords(joinedText, hints.textKeywords), method: "deterministic_text" };
  }
  if (hints.filenameKeywords) {
    return { documentTypeCode: code, confidence: scoreKeywords(originalFilename, hints.filenameKeywords), method: "filename" };
  }
  return null;
}

export async function runDeterministicClassification(
  tx: Prisma.TransactionClient,
  params: {
    documentVersionId: string;
    originalFilename: string;
    schemeVersionId: string;
    sourceFileContentHash: string;
    pageTexts: string[];
  }
): Promise<void> {
  const inputVersionHash = hashProcessingInput([params.sourceFileContentHash, "classify"]);

  await withProcessingJob(tx, params.documentVersionId, "classify", inputVersionHash, async () => {
    const joinedText = params.pageTexts
      .filter((t) => t.trim())
      .join("\n");

    const documentTypes = await tx.documentTypeDefinition.findMany({
      where: { schemeVersionId: params.schemeVersionId, active: true },
    });

    const candidates = documentTypes
      .map((dt) => scoreDocumentType(dt.code, parseClassificationHints(dt.classificationHints), params.originalFilename, joinedText))
      .filter((c): c is Candidate => c !== null && c.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);

    if (candidates.length === 0) return;

    const top = candidates[0];
    const suggested = top.confidence >= AUTO_SUGGEST_MIN;

    await tx.documentClassificationResult.create({
      data: {
        documentVersionId: params.documentVersionId,
        suggestedTypeCode: suggested ? top.documentTypeCode : null,
        candidateTypes: candidates as unknown as Prisma.InputJsonValue,
        confidence: top.confidence,
        method: top.method,
        classifierName: "deterministic-v1",
      },
    });

    await tx.documentVersion.update({
      where: { id: params.documentVersionId },
      data: { classificationStatus: suggested ? "suggested" : "unclear" },
    });
  });
}
