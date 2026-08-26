import { z } from "zod";

export const replacementReasonSchema = z.enum([
  "clearer_copy",
  "missing_pages",
  "corrected_document",
  "wrong_document",
  "updated_information",
  "requested_by_client",
  "other",
]);
export type ReplacementReasonInput = z.infer<typeof replacementReasonSchema>;

// FormData values are always strings — z.coerce.number() bridges the gap a
// JSON route's already-numeric body never has. These two schemas validate
// fields extracted FROM a multipart FormData body, not the raw request body
// itself (Zod never sees the File/Blob — that's checked imperatively against
// fileSignature.ts/limits.ts in the service layer).
export const uploadDocumentFieldsSchema = z.object({
  documentTypeCode: z.string().trim().min(1).max(100).optional(),
});
export type UploadDocumentFieldsInput = z.infer<typeof uploadDocumentFieldsSchema>;

export const replaceDocumentFieldsSchema = z.object({
  version: z.coerce.number().int().nonnegative(),
  replacementReason: replacementReasonSchema,
  documentTypeCode: z.string().trim().min(1).max(100).optional(),
});
export type ReplaceDocumentFieldsInput = z.infer<typeof replaceDocumentFieldsSchema>;

// Plain JSON route — no coercion needed.
export const confirmDocumentTypeSchema = z.object({
  version: z.number().int().nonnegative(),
  documentTypeCode: z.string().trim().min(1).max(100),
});
export type ConfirmDocumentTypeInput = z.infer<typeof confirmDocumentTypeSchema>;

export const correctExtractedFieldSchema = z.object({
  value: z.string().trim().min(1).max(2000),
  reason: z.string().trim().max(2000).optional(),
});
export type CorrectExtractedFieldInput = z.infer<typeof correctExtractedFieldSchema>;

export const addDocumentTypeSchema = z.object({
  version: z.number().int().nonnegative(),
  // Which of the Scheme's own unpublished draft versions to add this
  // Document Type to — see scheme.ts's addSchemeRuleSchema for why this
  // can't be derived from "the current version" implicitly.
  schemeVersionId: z.string().uuid(),
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  acceptedMimeTypes: z.array(z.string()).default([]),
  required: z.boolean().default(false),
  multipleAllowed: z.boolean().default(true),
  expectedFields: z.array(z.unknown()).default([]),
  // Segment 6's deterministic classifier reads this as
  // { filenameKeywords?: string[]; textKeywords?: string[] } — kept as a
  // union with the legacy empty-array shape rather than a strict object
  // schema, since older/unconfigured rows still hold `[]`.
  classificationHints: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).default([]),
  captureGuidance: z.string().trim().max(2000).optional(),
  displayOrder: z.number().int().nonnegative().default(0),
});
export type AddDocumentTypeInput = z.infer<typeof addDocumentTypeSchema>;

// NOT derived via .partial() from addDocumentTypeSchema — same reasoning as
// scheme.ts's updateSchemeRuleSchema: that schema's fields carry
// .default(...), which .partial() would silently reapply on every omitted
// field. Every field here is genuinely optional with no default.
export const updateDocumentTypeSchema = z.object({
  version: z.number().int().nonnegative(),
  schemeVersionId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  acceptedMimeTypes: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  multipleAllowed: z.boolean().optional(),
  expectedFields: z.array(z.unknown()).optional(),
  classificationHints: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  captureGuidance: z.string().trim().max(2000).optional().nullable(),
  displayOrder: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeSchema>;
