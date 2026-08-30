import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  subject: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().min(10).max(5000)
});
export type ContactInput = z.infer<typeof contactSchema>;

export type ContactErrorCode = 'invalid' | 'captcha' | 'rate_limited' | 'send_failed';

export interface ContactContext {
  userId?: string | null;
  locale: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type SubmitContactResult =
  | { ok: true; id: string; notified: { email: boolean; discord: boolean } }
  | { ok: false; code: ContactErrorCode };
