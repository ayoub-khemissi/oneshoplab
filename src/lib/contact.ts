import { randomUUID } from 'node:crypto';
import { and, gte, or, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { contactMessages } from '@/lib/db/schema';
import { postDiscordMessage, type DiscordChannel } from '@/lib/discord';
import { sendMail } from '@/lib/mailer';
import { getAppContactEmail } from '@/lib/app-contact';

/**
 * Contact-form core, independent of Next request plumbing so it can be
 * driven from the server action AND from a script (smoke test, replay).
 *
 * Flow: validate → abuse rate-limit → persist → fan out to Discord +
 * inbox. Persist-first is deliberate: a webhook/SMTP hiccup must never
 * lose a message someone took the time to write. The *NotifiedAt
 * columns record which channels actually fired.
 */

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

/** Abuse guard: max 3 submissions per 10 min from the same email OR
 *  the same IP. Cheap DB count — no extra infra — and generous enough
 *  that a real person correcting a typo never hits it. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;

export async function isContactRateLimited(email: string, ip: string | null | undefined): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const who = ip ? or(eq(contactMessages.email, email), eq(contactMessages.ip, ip)) : eq(contactMessages.email, email);
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)` })
    .from(contactMessages)
    .where(and(gte(contactMessages.createdAt, since), who))) as Array<{ n: number }>;
  return Number(n) >= RATE_MAX;
}

function inboxAddress(): string {
  return process.env.CONTACT_INBOX_EMAIL ?? getAppContactEmail();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildEmail(input: ContactInput, ctx: ContactContext, id: string) {
  const subject = input.subject?.trim() || '(sans objet)';
  const appUrl = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');
  const rows: Array<[string, string]> = [
    ['Nom', input.name],
    ['Email', input.email],
    ['Objet', subject],
    ['Langue', ctx.locale],
    ['Compte', ctx.userId ? `${appUrl}/fr/admin (user ${ctx.userId})` : 'visiteur non connecté'],
    ['IP', ctx.ip ?? '—'],
    ['Navigateur', ctx.userAgent ?? '—'],
    ['ID', id]
  ];
  const text =
    `Nouveau message via le formulaire de contact\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\n--- Message ---\n${input.message}\n`;
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#111;line-height:1.5">` +
    `<h2 style="margin:0 0 12px;font-size:16px">📩 Nouveau message via le formulaire de contact</h2>` +
    `<table style="border-collapse:collapse;margin:0 0 16px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 12px 3px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`
      )
      .join('') +
    `</table>` +
    `<div style="white-space:pre-wrap;border-left:3px solid #ddd;padding:8px 12px;background:#fafafa">${escapeHtml(input.message)}</div>` +
    `<p style="margin:16px 0 0;color:#888;font-size:12px">Répondre à ce mail répond directement à ${escapeHtml(input.email)}.</p>` +
    `</div>`;
  return { subject: `[Contact] ${subject} — ${input.name}`, text, html };
}

/** Contact messages carry a visitor's email — they belong in a private
 *  channel. `contact` is the dedicated #📩-contact feed the bot exposes
 *  (scripts/setup-contact-channel.mts); DISCORD_CONTACT_CHANNEL overrides. */
function discordChannel(): DiscordChannel {
  return (process.env.DISCORD_CONTACT_CHANNEL as DiscordChannel | undefined) ?? 'contact';
}

/** `<@&roleId>` pings the whole Admin role on every submission so a
 *  contact message is never just another unread channel. Discord only
 *  renders/pings a mention that sits in the message content, hence the
 *  prefix. A non-mentionable role still pings when the bot holds the
 *  MentionEveryone permission in the channel. */
function discordMention(): string {
  const id = process.env.DISCORD_CONTACT_MENTION_ROLE_ID?.trim();
  return id && /^\d{5,25}$/.test(id) ? `<@&${id}> ` : '';
}

/** Plain Discord markdown — the bot API takes `content` only (no embeds). */
function buildDiscordContent(input: ContactInput, ctx: ContactContext, id: string): string {
  const subject = input.subject?.trim() || '—';
  // Quote each line so the message body reads as a block even when it
  // contains blank lines; cap it so the header never gets truncated away.
  const body = input.message
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  const header =
    `${discordMention()}📩 **Nouveau message de contact**\n` +
    `**De :** ${input.name} <${input.email}>\n` +
    `**Objet :** ${subject}\n` +
    `**Langue :** ${ctx.locale} · ${ctx.userId ? 'compte connecté' : 'visiteur'}\n`;
  const footer = `\n-# id ${id} · répondre : ${input.email}`;
  const room = 4000 - header.length - footer.length;
  return header + (body.length > room ? `${body.slice(0, room - 1)}…` : body) + footer;
}

export async function submitContactMessage(
  input: ContactInput,
  ctx: ContactContext
): Promise<SubmitContactResult> {
  if (await isContactRateLimited(input.email, ctx.ip)) {
    return { ok: false, code: 'rate_limited' };
  }

  const id = randomUUID();
  await db.insert(contactMessages).values({
    id,
    userId: ctx.userId ?? null,
    name: input.name,
    email: input.email,
    subject: input.subject?.trim() || null,
    message: input.message,
    locale: ctx.locale,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null
  });

  const mail = buildEmail(input, ctx, id);
  const [emailRes, discordRes] = await Promise.allSettled([
    sendMail({ to: inboxAddress(), subject: mail.subject, html: mail.html, text: mail.text, replyTo: input.email }),
    postDiscordMessage(discordChannel(), buildDiscordContent(input, ctx, id))
  ]);

  const emailOk = emailRes.status === 'fulfilled' && emailRes.value.ok;
  const discordOk = discordRes.status === 'fulfilled' && discordRes.value.ok;
  const now = new Date();
  await db
    .update(contactMessages)
    .set({
      emailNotifiedAt: emailOk ? now : null,
      discordNotifiedAt: discordOk ? now : null
    })
    .where(eq(contactMessages.id, id));

  if (!emailOk && !discordOk) {
    // Message IS saved — surface loudly for the operator, but the
    // sender still gets a success (their message wasn't lost).
    console.error('[contact] stored message', id, 'but NO notification channel succeeded', {
      email: emailRes.status === 'fulfilled' ? emailRes.value.reason : 'threw',
      discord: discordRes.status === 'fulfilled' ? discordRes.value.reason : 'threw'
    });
  }

  return { ok: true, id, notified: { email: emailOk, discord: discordOk } };
}
