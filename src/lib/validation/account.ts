import { z } from "zod";

export const createAccountSchema = z.object({
  email: z.string().trim().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(["client_admin", "provider_user"]), // super_admin accounts are not self-service creatable via this endpoint
  providerId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setPasswordSchema = z.object({
  email: z.string().trim().email(),
  tempPassword: z.string().min(1),
  newPassword: z.string().min(12).max(200),
});
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
