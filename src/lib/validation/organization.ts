import { z } from "zod";

export const clientCapabilitySchema = z.enum([
  "assistance_company",
  "insurance_company",
]);

export const createClientSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  capabilities: z.array(clientCapabilitySchema).min(1),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const createProviderSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  country: z.string().trim().length(2), // ISO 3166-1 alpha-2
  officialRegistrationNumber: z.string().trim().min(1).optional(),
  taxId: z.string().trim().min(1).optional(),
  healthcareLicenseNumber: z.string().trim().min(1).optional(),
  addressLine: z.string().trim().optional(),
  city: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  confirmedNotDuplicateBy: z.string().uuid().optional(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const createRelationshipSchema = z.object({
  providerId: z.string().uuid(),
});
export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;
