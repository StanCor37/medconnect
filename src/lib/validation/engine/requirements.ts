import type { Prisma } from "@/generated/prisma/client";
import type { RequirementStatus } from "@/generated/prisma/enums";
import { recommendationForRequirement } from "@/lib/validation/engine/recommendations";

export interface RequirementResultDraft {
  requirementType: "document" | "field" | "readability" | "classification" | "split_confirmation";
  documentTypeCode: string | null;
  fieldDefinitionId: string | null;
  status: RequirementStatus;
  reasonCode: string;
  recommendationCode: ReturnType<typeof recommendationForRequirement>;
}

type SchemeVersionWithTypes = Prisma.ValidationSchemeVersionGetPayload<{
  include: { documentTypeDefinitions: { include: { extractionFieldDefinitions: true } } };
}>;
type DocumentWithVersion = Prisma.DocumentGetPayload<{ include: { currentVersion: true } }>;

function statusForExtractedField(status: string | undefined): RequirementStatus {
  if (!status) return "missing";
  if (status === "absent") return "missing";
  if (status === "unreadable") return "unreadable";
  if (status === "invalid" || status === "failed") return "invalid";
  if (status === "inconsistent") return "unconfirmed";
  return "satisfied"; // extracted | confirmed | corrected | low_confidence — a usable value exists
}

/**
 * Represents completeness separately from insurance-rule outcomes (spec
 * §9) — a missing medical report is a missing REQUIREMENT, never a failed
 * rule. Only evaluates documents/fields the pinned Scheme version actually
 * defines as required, plus flags any uploaded-but-not-yet-classified
 * Document so it surfaces as an actionable item too.
 */
export async function evaluateRequirements(
  tx: Prisma.TransactionClient,
  caseId: string,
  schemeVersion: SchemeVersionWithTypes,
  documents: DocumentWithVersion[]
): Promise<RequirementResultDraft[]> {
  const results: RequirementResultDraft[] = [];

  const latestByType = new Map<string, DocumentWithVersion>();
  for (const doc of documents.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!doc.documentTypeCode || !doc.currentVersionId) continue;
    latestByType.set(doc.documentTypeCode, doc);
  }

  for (const doc of documents) {
    if (doc.documentTypeCode) continue; // already classified
    results.push({
      requirementType: "classification",
      documentTypeCode: null,
      fieldDefinitionId: null,
      status: "unconfirmed",
      reasonCode: "document_type_not_confirmed",
      recommendationCode: recommendationForRequirement("classification", null),
    });
  }

  for (const dt of schemeVersion.documentTypeDefinitions) {
    if (!dt.required) continue;
    const doc = latestByType.get(dt.code);
    let status: RequirementStatus;
    let reasonCode: string;
    if (!doc) {
      status = "missing";
      reasonCode = "document_missing";
    } else if (doc.currentVersion?.readabilityStatus !== "readable") {
      status = "unreadable";
      reasonCode = "document_unreadable";
    } else {
      status = "satisfied";
      reasonCode = "document_present";
    }
    results.push({
      requirementType: "document",
      documentTypeCode: dt.code,
      fieldDefinitionId: null,
      status,
      reasonCode,
      recommendationCode: recommendationForRequirement("document", dt.code),
    });

    if (!doc) continue; // don't also report every one of its fields as separately "missing" — one row is enough

    const fieldIds = dt.extractionFieldDefinitions.filter((f) => f.required).map((f) => f.id);
    if (fieldIds.length === 0) continue;
    const extractedFields = await tx.extractedField.findMany({
      where: { documentVersionId: doc.currentVersionId!, fieldDefinitionId: { in: fieldIds } },
    });
    const byFieldId = new Map(extractedFields.map((f) => [f.fieldDefinitionId, f]));

    for (const fieldDef of dt.extractionFieldDefinitions) {
      if (!fieldDef.required) continue;
      const extracted = byFieldId.get(fieldDef.id);
      const fieldStatus = statusForExtractedField(extracted?.status);
      results.push({
        requirementType: "field",
        documentTypeCode: dt.code,
        fieldDefinitionId: fieldDef.id,
        status: fieldStatus,
        reasonCode: `field_${fieldStatus}`,
        recommendationCode: recommendationForRequirement("field", dt.code),
      });
    }
  }

  return results;
}
