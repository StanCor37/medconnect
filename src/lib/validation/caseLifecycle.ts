import { z } from "zod";

const versionOnly = { version: z.number().int().nonnegative() };

export const submitCaseSchema = z.object({ ...versionOnly, confirm: z.literal(true) });
export type SubmitCaseInput = z.infer<typeof submitCaseSchema>;

export const returnCaseSchema = z.object({
  ...versionOnly,
  returnReason: z.enum([
    "missing_document",
    "unreadable_document",
    "incorrect_document",
    "incorrect_information",
    "validation_conflict",
    "additional_information_required",
    "other",
  ]),
  reason: z.string().trim().max(2000).optional(),
});
export type ReturnCaseInput = z.infer<typeof returnCaseSchema>;

export const acceptCaseSchema = z.object(versionOnly);
export type AcceptCaseInput = z.infer<typeof acceptCaseSchema>;

export const rejectCaseSchema = z.object({
  ...versionOnly,
  rejectionReason: z.enum([
    "documentation_incomplete",
    "information_inconsistent",
    "not_eligible",
    "duplicate_submission",
    "outside_policy_period",
    "service_not_covered",
    "client_decision",
    "other",
  ]),
  rejectionNote: z.string().trim().min(1).max(2000),
});
export type RejectCaseInput = z.infer<typeof rejectCaseSchema>;

export const markLiquidatedSchema = z.object({
  ...versionOnly,
  liquidationSource: z.string().trim().max(200).optional(),
  externalLiquidationReference: z.string().trim().max(200).optional(),
});
export type MarkLiquidatedInput = z.infer<typeof markLiquidatedSchema>;

export const closeCaseSchema = z.object(versionOnly);
export type CloseCaseInput = z.infer<typeof closeCaseSchema>;

export const cancelCaseSchema = z.object({
  ...versionOnly,
  cancellationReason: z.enum(["created_by_mistake", "duplicate_case", "patient_withdrew", "service_not_performed", "submitted_elsewhere", "other"]),
  cancellationNote: z.string().trim().max(2000).optional(),
});
export type CancelCaseInput = z.infer<typeof cancelCaseSchema>;

export const reopenCaseSchema = z.object({
  ...versionOnly,
  reason: z.string().trim().min(1).max(2000),
});
export type ReopenCaseInput = z.infer<typeof reopenCaseSchema>;
