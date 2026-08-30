/**
 * Contact form: persist-first, then notify by email (Reply-To = visitor) and
 * Discord (#contact); rate limit 3 / 10 min per email or IP; honeypot and
 * captcha handled in the server action.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const postDiscordMessage = vi.fn();
const verifyRecaptcha = vi.fn();
vi.mock('@/shared/mailer', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));
vi.mock('@/shared/discord', () => ({
  postDiscordMessage: (...a: unknown[]) => postDiscordMessage(...a)
}));
vi.mock('@/shared/recaptcha', () => ({
  verifyRecaptcha: (...a: unknown[]) => verifyRecaptcha(...a)
}));
vi.mock('@/entities/user/api/next-auth', () => ({ auth: async () => null }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
}));

import { sql } from 'drizzle-orm';
import {
  contactSchema,
  isContactRateLimited,
  submitContactMessage
} from '@/entities/contact-message';
import { submitContactAction } from '@/features/contact';
import { db } from '@/shared/db';

const input = {
  name: 'Visitor',
  email: 'visitor@test.local',
  subject: 'Hello',
  message: 'I have a question about the Pro plan.'
};
const ctx = { locale: 'fr', ip: '203.0.113.9' };

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE contact_messages`);
  sendMail.mockReset().mockResolvedValue({ ok: true });
  postDiscordMessage.mockReset().mockResolvedValue({ ok: true });
  verifyRecaptcha.mockReset().mockResolvedValue({ ok: true });
});
afterAll(async () => {
  await db.$client.end();
});

describe('contactSchema', () => {
  it('normalises the email and rejects junk', () => {
    expect(contactSchema.parse({ ...input, email: ' Visitor@Test.LOCAL ' }).email).toBe(
      'visitor@test.local'
    );
    expect(contactSchema.safeParse({ ...input, email: 'nope' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...input, message: 'short' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...input, name: 'V' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...input, subject: '' }).success).toBe(true);
  });
});

describe('submitContactMessage', () => {
  it('stores the message first, then emails (Reply-To visitor) and posts to #contact', async () => {
    const res = await submitContactMessage(input, ctx);
    expect(res).toMatchObject({ ok: true, notified: { email: true, discord: true } });
    const rows = await db.query.contactMessages.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: input.email, message: input.message, ip: ctx.ip });
    expect(rows[0].emailNotifiedAt).toBeInstanceOf(Date);
    expect(rows[0].discordNotifiedAt).toBeInstanceOf(Date);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ replyTo: input.email });
    expect(postDiscordMessage.mock.calls[0][0]).toBe('contact');
    expect(String(postDiscordMessage.mock.calls[0][1])).toContain(input.email);
  });

  it('still succeeds for the sender when both channels fail — the message is not lost', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    postDiscordMessage.mockResolvedValue({ ok: false, reason: 'bot offline' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await submitContactMessage(input, ctx);
    expect(res).toMatchObject({ ok: true, notified: { email: false, discord: false } });
    const [row] = await db.query.contactMessages.findMany();
    expect(row.emailNotifiedAt).toBeNull();
    expect(row.discordNotifiedAt).toBeNull();
  });

  it('rate-limits the 4th message in 10 minutes, by email or by IP', async () => {
    for (let i = 0; i < 3; i++) expect((await submitContactMessage(input, ctx)).ok).toBe(true);
    expect(await submitContactMessage(input, ctx)).toEqual({ ok: false, code: 'rate_limited' });
    expect(await isContactRateLimited('other@test.local', ctx.ip)).toBe(true);
    expect(await isContactRateLimited(input.email, '198.51.100.1')).toBe(true);
    expect(await isContactRateLimited('other@test.local', '198.51.100.1')).toBe(false);
    expect(await db.query.contactMessages.findMany()).toHaveLength(3);
  });
});

describe('submitContactAction', () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ ...input, recaptcha_token: 'tok', ...o })) f.set(k, v);
    return f;
  };

  it('honeypot filled → fake success, nothing stored, no captcha call', async () => {
    const res = await submitContactAction({ status: 'idle' }, form({ website: 'http://spam' }));
    expect(res).toEqual({ status: 'success' });
    expect(await db.query.contactMessages.findMany()).toHaveLength(0);
    expect(verifyRecaptcha).not.toHaveBeenCalled();
  });

  it('invalid input → error with values echoed back, before the captcha', async () => {
    const res = await submitContactAction({ status: 'idle' }, form({ email: 'nope' }));
    expect(res).toMatchObject({ status: 'error', code: 'invalid' });
    expect(verifyRecaptcha).not.toHaveBeenCalled();
  });

  it('captcha failure → error, nothing stored', async () => {
    verifyRecaptcha.mockResolvedValue({ ok: false });
    const res = await submitContactAction({ status: 'idle' }, form({}));
    expect(res).toMatchObject({ status: 'error', code: 'captcha' });
    expect(await db.query.contactMessages.findMany()).toHaveLength(0);
  });

  it('happy path stores the client IP from x-forwarded-for', async () => {
    const res = await submitContactAction({ status: 'idle' }, form({}));
    expect(res).toEqual({ status: 'success' });
    const [row] = await db.query.contactMessages.findMany();
    expect(row.ip).toBe('203.0.113.9');
  });
});
