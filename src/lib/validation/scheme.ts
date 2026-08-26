import { z } from "zod";
import { ownershipScopeSchema, hitlPolicySchema } from "./rule";

export const createSchemeSchema = z.object({
  // Overridden by the service layer based on actor role — never trusted verbatim.
  scope: ownershipScopeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  insurerId: z.string().uuid().optional(),
  productLine: z.string().trim().optional(),
  productId: z.string().trim().optional(),
  countryCodes: z.array(z.string().length(2)).default([]),
});
export type CreateSchemeInput = z.infer<typeof createSchemeSchema>;

export const addSchemeRuleSchema = z.object({
  version: z.number().int().nonnegative(),
  // Which of the Scheme's own unpublished draft versions to add this Rule
  // pairing to — required explicitly rather than assumed to be "the current
  // version," since a Scheme can have a not-yet-current draft in progress
  // (created by createNextDraftSchemeVersionService while a prior version
  // is still published and current).
  schemeVersionId: z.string().uuid(),
  ruleVersionId: z.string().uuid(),
  executionOrder: z.number().int().nonnegative().default(0),
  parameters: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  hitlPolicyOverride: hitlPolicySchema.optional().nullable(),
});
export type AddSchemeRuleInput = z.infer<typeof addSchemeRuleSchema>;

// NOT derived from addSchemeRuleSchema via .partial() — that schema's
// fields carry .default(...), which would silently reapply defaults (e.g.
// enabled: true) for any field simply omitted from a partial-update body.
// Every field here is genuinely optional with no default, so an omitted key
// means "leave unchanged," not "reset to default."
export const updateSchemeRuleSchema = z.object({
  version: z.number().int().nonnegative(),
  schemeVersionId: z.string().uuid(),
  executionOrder: z.number().int().nonnegative().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  hitlPolicyOverride: hitlPolicySchema.optional().nullable(),
});
export type UpdateSchemeRuleInput = z.infer<typeof updateSchemeRuleSchema>;

// Used by the two DELETE routes (remove-rule, remove-document-type) instead
// of the generic versionOnlySchema — removal also needs to know which draft
// version to remove from.
export const schemeVersionTargetSchema = z.object({
  version: z.number().int().nonnegative(),
  schemeVersionId: z.string().uuid(),
});
export type SchemeVersionTargetInput = z.infer<typeof schemeVersionTargetSchema>;

export const publishSchemeSchema = z.object({
  version: z.number().int().nonnegative(),
  versionId: z.string().uuid(),
});
export type PublishSchemeInput = z.infer<typeof publishSchemeSchema>;

export const assignSchemeSchema = z.object({
  version: z.number().int().nonnegative(),
  schemeVersionId: z.string().uuid(),
});
export type AssignSchemeInput = z.infer<typeof assignSchemeSchema>;
