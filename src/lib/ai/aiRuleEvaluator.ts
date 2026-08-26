import type { TechnicalErrorCode } from "@/generated/prisma/enums";
import type { AiRuleOutput } from "@/lib/validation/aiRuleOutput";

/**
 * Explicit dependency, not an imported singleton — same pattern as
 * OcrClient (src/lib/processing/ocrClient.ts) and StorageAdapter: lets
 * tests substitute a fake without ever calling the real Claude API.
 */
export interface AiRuleEvaluatorInput {
  ruleVersionId: string;
  evaluationQuestion: string;
  evidenceRequirements: string[];
  evidenceText: { documentVersionId: string; documentTypeCode: string; pageNumber: number; text: string }[];
}

export interface AiRuleEvaluatorResult extends AiRuleOutput {
  modelId: string;
  promptVersion: string;
}

export class AiRuleEvaluatorError extends Error {
  constructor(
    public readonly code: TechnicalErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface AiRuleEvaluator {
  evaluate(input: AiRuleEvaluatorInput): Promise<AiRuleEvaluatorResult>;
}
