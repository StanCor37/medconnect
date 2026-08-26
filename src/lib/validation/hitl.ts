import { z } from "zod";

export const hitlDecisionTypeSchema = z.enum(["confirm", "override_to_pass", "override_to_fail", "request_documents", "return_to_provider"]);

export const decideHitlTaskSchema = z
  .object({
    version: z.number().int().nonnegative(),
    decision: hitlDecisionTypeSchema,
    reasonCode: z.string().trim().min(1).max(100).optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .refine((v) => (v.decision === "override_to_pass" || v.decision === "override_to_fail" ? !!v.reason?.trim() : true), {
    message: "A reason is required for override_to_pass/override_to_fail (spec §19: every override requires a reason)",
    path: ["reason"],
  });
export type DecideHitlTaskInput = z.infer<typeof decideHitlTaskSchema>;
