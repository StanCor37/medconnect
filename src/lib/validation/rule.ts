import { z } from "zod";

export const ownershipScopeSchema = z.enum(["global", "client"]);
export const ruleCategorySchema = z.enum([
  "document_requirement",
  "field_extraction",
  "data_consistency",
  "date_validation",
  "eligibility",
  "medical_clause",
  "financial_validation",
  "fraud_indicator",
]);
export const ruleExecutionTypeSchema = z.enum(["deterministic", "ai_assisted"]);
export const ruleSeveritySchema = z.enum(["info", "warning", "blocking"]);
export const hitlPolicySchema = z.enum(["never", "on_needs_review", "on_fail", "always"]);

export const ruleApplicabilitySchema = z
  .object({
    clientId: z.string().uuid().optional(),
    insurerId: z.string().uuid().optional(),
    productLine: z.string().trim().optional(),
    productId: z.string().trim().optional(),
    countryCodes: z.array(z.string().length(2)).optional(),
    jurisdictionCodes: z.array(z.string()).optional(),
    documentTypes: z.array(z.string()).optional(),
    caseTypes: z.array(z.string()).optional(),
  })
  .default({});
export type RuleApplicability = z.infer<typeof ruleApplicabilitySchema>;

const fieldPath = z.string().trim().min(1);
const valueTypeSchema = z.enum(["string", "name", "date", "money"]).default("string");

const equalsParamsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fieldToField"), fieldPathA: fieldPath, fieldPathB: fieldPath, valueType: valueTypeSchema }),
  z.object({ mode: z.literal("fieldToValue"), fieldPath, expectedValue: z.unknown(), valueType: valueTypeSchema }),
]);

const dateCompareParamsSchema = z
  .object({
    datePath: fieldPath,
    boundaryPath: fieldPath.optional(),
    boundaryValue: z.union([z.string(), z.number(), z.date()]).optional(),
    inclusive: z.boolean().default(false),
  })
  .refine((v) => (v.boundaryPath !== undefined) !== (v.boundaryValue !== undefined), {
    message: "Exactly one of boundaryPath or boundaryValue is required",
  });

const amountCompareParamsSchema = z
  .object({
    amountPath: fieldPath,
    thresholdPath: fieldPath.optional(),
    thresholdValue: z.union([z.string(), z.number()]).optional(),
  })
  .refine((v) => (v.thresholdPath !== undefined) !== (v.thresholdValue !== undefined), {
    message: "Exactly one of thresholdPath or thresholdValue is required",
  });

export const deterministicRuleDefinitionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("required_document"), parameters: z.object({ documentTypePath: fieldPath }) }),
  z.object({ operation: z.literal("required_field"), parameters: z.object({ fieldPath }) }),
  z.object({ operation: z.literal("equals"), parameters: equalsParamsSchema }),
  z.object({ operation: z.literal("not_equals"), parameters: equalsParamsSchema }),
  z.object({
    operation: z.literal("date_between"),
    parameters: z.object({
      datePath: fieldPath,
      startPath: fieldPath,
      endPath: fieldPath,
      inclusiveStart: z.boolean().default(true),
      inclusiveEnd: z.boolean().default(true),
    }),
  }),
  z.object({ operation: z.literal("date_before"), parameters: dateCompareParamsSchema }),
  z.object({ operation: z.literal("date_after"), parameters: dateCompareParamsSchema }),
  z.object({ operation: z.literal("amount_less_than_or_equal"), parameters: amountCompareParamsSchema }),
  z.object({ operation: z.literal("amount_greater_than"), parameters: amountCompareParamsSchema }),
]);
export type DeterministicRuleDefinition = z.infer<typeof deterministicRuleDefinitionSchema>;

/** Inert config this phase — no evaluator runs against ai_assisted rules yet (Segment 6/7's job). */
export const aiRuleDefinitionSchema = z.object({
  evaluationQuestion: z.string().trim().min(1),
  evidenceRequirements: z.array(z.string()).default([]),
  applicabilityGate: z.object({
    requiredDocumentTypes: z.array(z.string()).default([]),
    requiredFields: z.array(z.string()).default([]),
    triggeringValues: z.record(z.string(), z.unknown()).default({}),
    skipConditions: z.array(z.string()).default([]),
  }),
  outputSchema: z.literal("AiRuleOutput").default("AiRuleOutput"), // fixed, never user-configurable
});
export type AiRuleDefinition = z.infer<typeof aiRuleDefinitionSchema>;

export const ruleDefinitionSchema = z.union([deterministicRuleDefinitionSchema, aiRuleDefinitionSchema]);

export const createRuleSchema = z.object({
  // Overridden by the service layer based on actor role — never trusted verbatim for a client_admin.
  scope: ownershipScopeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  category: ruleCategorySchema,
  executionType: ruleExecutionTypeSchema,
  definition: ruleDefinitionSchema,
  applicability: ruleApplicabilitySchema,
  providerMessageCode: z.string().trim().min(1).max(100),
  adminMessageCode: z.string().trim().min(1).max(100),
  severity: ruleSeveritySchema,
  hitlPolicy: hitlPolicySchema,
  confirmedNotDuplicateBy: z.string().uuid().optional(),
});
export type CreateRuleInput = z.infer<typeof createRuleSchema>;

export const updateDraftVersionSchema = z.object({
  version: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  definition: ruleDefinitionSchema.optional(),
  applicability: ruleApplicabilitySchema.optional(),
  providerMessageCode: z.string().trim().min(1).max(100).optional(),
  adminMessageCode: z.string().trim().min(1).max(100).optional(),
  severity: ruleSeveritySchema.optional(),
  hitlPolicy: hitlPolicySchema.optional(),
});
export type UpdateDraftVersionInput = z.infer<typeof updateDraftVersionSchema>;

export const publishRuleSchema = z.object({
  version: z.number().int().nonnegative(),
  versionId: z.string().uuid(),
});
export type PublishRuleInput = z.infer<typeof publishRuleSchema>;

export const promoteRuleSchema = z.object({
  versionId: z.string().uuid(),
  confirmedNotDuplicateBy: z.string().uuid().optional(),
});
export type PromoteRuleInput = z.infer<typeof promoteRuleSchema>;

export const checkDuplicateRuleSchema = z.object({
  category: ruleCategorySchema,
  executionType: ruleExecutionTypeSchema,
  name: z.string().trim().min(1),
  definition: ruleDefinitionSchema,
});
export type CheckDuplicateRuleInput = z.infer<typeof checkDuplicateRuleSchema>;
