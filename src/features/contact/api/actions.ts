'use server';

import { headers } from 'next/headers';
import { auth } from '@/entities/user';
import {
  contactSchema,
  submitContactMessage,
  type ContactErrorCode
} from '@/entities/contact-message';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

export interface ContactFormValues {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactFormState {
  status: 'idle' | 'success' | 'error';
  code?: ContactErrorCode;
  /** Echoed back on error so the form re-renders with what was typed. */
  values?: ContactFormValues;
}

export async function submitContactAction(
  _prev: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const values: ContactFormValues = {
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    subject: String(formData.get('subject') ?? ''),
    message: String(formData.get('message') ?? '')
  };

  // Honeypot: a hidden field humans never see. Bots that fill every
  // input get a silent "success" — no signal that they were caught.
  if (String(formData.get('website') ?? '').trim()) {
    return { status: 'success' };
  }

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { status: 'error', code: 'invalid', values };

  const captchaToken =
    String(formData.get('g-recaptcha-response') ?? '') ||
    String(formData.get('recaptcha_token') ?? '');
  const captcha = await verifyRecaptcha(captchaToken);
  if (!captcha.ok) return { status: 'error', code: 'captcha', values };

  const rawLocale = String(formData.get('locale') ?? 'en');
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale) ? rawLocale : 'en';

  const [session, h] = await Promise.all([auth(), headers()]);
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  const userAgent = h.get('user-agent');

  const res = await submitContactMessage(parsed.data, {
    userId: session?.user?.id ?? null,
    locale,
    ip,
    userAgent
  });
  if (!res.ok) return { status: 'error', code: res.code, values };
  return { status: 'success' };
}
