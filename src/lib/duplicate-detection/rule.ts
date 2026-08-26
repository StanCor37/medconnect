import type { Prisma } from "@/generated/prisma/client";
import type { RuleCategory, RuleExecutionType } from "@/generated/prisma/enums";
import type { DeterministicRuleDefinition, AiRuleDefinition } from "@/lib/validation/rule";

export function normalizeRuleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

/** Extracts every field-path referenced by a deterministic definition's parameters, order-independent. */
export function extractFieldPaths(definition: DeterministicRuleDefinition): string[] {
  const paths = new Set<string>();
  const p = definition.parameters as Record<string, unknown>;
  for (const key of [
    "documentTypePath",
    "fieldPath",
    "fieldPathA",
    "fieldPathB",
    "datePath",
    "startPath",
    "endPath",
    "boundaryPath",
    "amountPath",
    "thresholdPath",
  ]) {
    const value = p[key];
    if (typeof value === "string") paths.add(value);
  }
  return Array.from(paths).sort();
}

function normalizedParametersString(definition: DeterministicRuleDefinition): string {
  const sorted = Object.keys(definition.parameters as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (definition.parameters as Record<string, unknown>)[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

export interface RuleDuplicateInput {
  clientId: string | null; // null = creating a global rule (Super Admin); searches only other global rules
  category: RuleCategory;
  executionType: RuleExecutionType;
  name: string;
  definition: DeterministicRuleDefinition | AiRuleDefinition;
}

export type RuleDuplicateResult =
  | { kind: "exact_match"; ruleId: string; ruleVersionId: string }
  | { kind: "probable_match"; candidates: { ruleId: string; ruleVersionId: string; name: string }[] }
  | { kind: "no_match" };

/**
 * Segment 3 §9: search (1) published global rules, (2) rules owned by the
 * same Client. exact_match BLOCKS creation; probable_match WARNS and
 * requires confirmedNotDuplicateBy — same three-way shape as
 * checkForDuplicateProvider/checkForDuplicateCase.
 */
export async function checkForDuplicateRule(
  tx: Prisma.TransactionClient,
  input: RuleDuplicateInput,
  excludeRuleId?: string
): Promise<RuleDuplicateResult> {
  const candidates = await tx.validationRule.findMany({
    where: {
      id: excludeRuleId ? { not: excludeRuleId } : undefined,
      category: input.category,
      executionType: input.executionType,
      OR: [
        { scope: "global", status: "published" },
        ...(input.clientId ? [{ scope: "client" as const, clientId: input.clientId }] : []),
      ],
    },
    include: { currentVersion: true },
  });

  const normalizedInputName = normalizeRuleName(input.name);
  const isDeterministic = "operation" in input.definition;
  const inputFieldPaths = isDeterministic ? extractFieldPaths(input.definition as DeterministicRuleDefinition) : [];
  const inputParamsString = isDeterministic ? normalizedParametersString(input.definition as DeterministicRuleDefinition) : null;
  const inputOperation = isDeterministic ? (input.definition as DeterministicRuleDefinition).operation : null;

  const probableMatches: { ruleId: string; ruleVersionId: string; name: string }[] = [];

  for (const candidate of candidates) {
    if (!candidate.currentVersion) continue;
    const candidateDefinition = candidate.currentVersion.definition as unknown as
      | DeterministicRuleDefinition
      | AiRuleDefinition;
    const candidateName = normalizeRuleName(candidate.currentVersion.name);

    if (isDeterministic && "operation" in candidateDefinition) {
      const sameOperation = candidateDefinition.operation === inputOperation;
      if (sameOperation) {
        const candidateFieldPaths = extractFieldPaths(candidateDefinition as DeterministicRuleDefinition);
        const candidateParamsString = normalizedParametersString(candidateDefinition as DeterministicRuleDefinition);
        const sameFieldPaths =
          candidateFieldPaths.length === inputFieldPaths.length &&
          candidateFieldPaths.every((p, i) => p === inputFieldPaths[i]);
        const sameParams = candidateParamsString === inputParamsString;

        if (sameFieldPaths && sameParams && candidateName === normalizedInputName) {
          return { kind: "exact_match", ruleId: candidate.id, ruleVersionId: candidate.currentVersion.id };
        }
        probableMatches.push({ ruleId: candidate.id, ruleVersionId: candidate.currentVersion.id, name: candidate.currentVersion.name });
        continue;
      }
    }

    // ai_assisted (or a deterministic/ai_assisted mismatch, which shouldn't
    // occur given the category+executionType filter above): only ever a
    // name-similarity probable match, never an exact match — there's no
    // deterministic definition to compare byte-for-byte.
    if (
      candidateName === normalizedInputName ||
      candidateName.includes(normalizedInputName) ||
      normalizedInputName.includes(candidateName)
    ) {
      probableMatches.push({ ruleId: candidate.id, ruleVersionId: candidate.currentVersion.id, name: candidate.currentVersion.name });
    }
  }

  if (probableMatches.length > 0) {
    return { kind: "probable_match", candidates: probableMatches };
  }
  return { kind: "no_match" };
}
