import { z } from "zod";

/**
 * The ENTIRE structured contract an AI-assisted rule's evaluation must
 * return — deliberately tiny, with no free-text reasoning/explanation field.
 * `reasonCode` on the stored ValidationRuleResult is derived server-side
 * from `outcome` alone (see src/lib/validation/engine/aiPhase.ts), never
 * trusted from the model — this is what makes "never expose raw model
 * output/prompts" (spec §13/§29) true by construction rather than by
 * redaction after the fact.
 */
export const aiRuleOutputSchema = z
  .object({
    outcome: z.enum(["pass", "fail", "needs_review"]),
    confidence: z.number().min(0).max(1),
    evidence: z
      .array(
        z.object({
          documentVersionId: z.string().uuid(),
          pageNumber: z.number().int().positive().optional(),
          quote: z.string().trim().min(1).max(200),
        })
      )
      .max(5)
      .default([]),
  })
  .strict();

export type AiRuleOutput = z.infer<typeof aiRuleOutputSchema>;

/** Anthropic tool-use `input_schema` mirroring aiRuleOutputSchema 1:1 — see claudeAiRuleEvaluator.ts. */
export const AI_RULE_OUTPUT_TOOL_NAME = "record_rule_evaluation";
export const aiRuleOutputToolInputSchema = {
  type: "object" as const,
  properties: {
    outcome: { type: "string", enum: ["pass", "fail", "needs_review"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          documentVersionId: { type: "string" },
          pageNumber: { type: "integer", minimum: 1 },
          quote: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["documentVersionId", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["outcome", "confidence"],
  additionalProperties: false,
};
