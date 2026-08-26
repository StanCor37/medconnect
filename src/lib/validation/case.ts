import { z } from "zod";

export const externalReferenceSourceSchema = z.enum([
  "client",
  "insurer",
  "provider",
  "partner_api",
  "manual",
]);

export const createCaseSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    insurerId: z.string().uuid().optional(),
    serviceType: z.string().trim().min(1).max(100).optional(),
    patientReference: z.string().trim().min(1).max(200).optional(),
    eventDate: z.coerce.date().optional(),
    externalReference: z.string().trim().min(1).max(200).optional(),
    externalReferenceSource: externalReferenceSourceSchema.optional(),
    confirmedNotDuplicateBy: z.string().uuid().optional(),
  })
  .refine((v) => !v.externalReference || v.externalReferenceSource, {
    message: "externalReferenceSource is required when externalReference is provided",
    path: ["externalReferenceSource"],
  });
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const updateCaseSchema = z.object({
  version: z.number().int().nonnegative(),
  serviceType: z.string().trim().min(1).max(100).optional(),
  patientReference: z.string().trim().min(1).max(200).optional(),
  eventDate: z.coerce.date().optional().nullable(),
  insurerId: z.string().uuid().optional().nullable(),
  externalReference: z.string().trim().min(1).max(200).optional().nullable(),
  externalReferenceSource: externalReferenceSourceSchema.optional().nullable(),
});
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

export const shareWithClientSchema = z.object({
  version: z.number().int().nonnegative(),
  clientId: z.string().uuid(),
});
export type ShareWithClientInput = z.infer<typeof shareWithClientSchema>;

export const assignCaseSchema = z.object({
  version: z.number().int().nonnegative(),
  assignedToUserId: z.string().uuid(),
});
export type AssignCaseInput = z.infer<typeof assignCaseSchema>;

export const versionOnlySchema = z.object({
  version: z.number().int().nonnegative(),
});
export type VersionOnlyInput = z.infer<typeof versionOnlySchema>;
