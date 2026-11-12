import { z } from 'zod';

export const userRoleSchema = z.enum(['master', 'member']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: userRoleSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const memberSchema = publicUserSchema.extend({
  email: z.string().email(),
  disabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Member = z.infer<typeof memberSchema>;

const nameSchema = z.string().trim().min(1, 'Enter your name').max(100);
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200)
  .regex(/\p{L}/u, 'Password must include at least one letter')
  .regex(/\p{N}/u, 'Password must include at least one number')
  .regex(/[\p{P}\p{S}]/u, 'Password must include at least one symbol');
const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

export const loginBodySchema = z.object({
  name: nameSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const verifyOtpBodySchema = z.object({
  name: nameSchema,
  code: otpCodeSchema,
});
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;

export const resendOtpBodySchema = z.object({ name: nameSchema });
export type ResendOtpBody = z.infer<typeof resendOtpBodySchema>;

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(200),
  code: otpCodeSchema,
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const createMemberBodySchema = z.object({
  name: nameSchema,
  email: z.string().trim().email('Enter a valid email address'),
  password: passwordSchema,
});
export type CreateMemberBody = z.infer<typeof createMemberBodySchema>;

export const resetMemberPasswordBodySchema = z.object({
  password: passwordSchema,
});
export type ResetMemberPasswordBody = z.infer<typeof resetMemberPasswordBodySchema>;

export const updateMemberBodySchema = z.object({
  disabled: z.boolean(),
});
export type UpdateMemberBody = z.infer<typeof updateMemberBodySchema>;

export const loginAcceptedSchema = z.object({
  status: z.literal('otp_sent'),
  message: z.string(),
});
export type LoginAccepted = z.infer<typeof loginAcceptedSchema>;

export const sessionResponseSchema = z.object({ user: publicUserSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
