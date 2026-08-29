import nodemailer from 'nodemailer';
import { getAppContactEmail } from '@/lib/app-contact';

/**
 * Transactional mail entry point. Reads SMTP credentials from env
 * (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD plus the
 * SMTP_FROM_EMAIL + SMTP_FROM_NAME fallback) and sends through
 * nodemailer.
 *
 * Dev-friendly: when SMTP_HOST is unset, sendMail logs the payload
 * and returns `{ ok: false, reason: 'unconfigured' }` instead of
 * throwing — features that branch on the `ok` flag still work
 * (password reset request, for example, returns the same generic
 * "if the email exists, a link was sent" response so an attacker
 * can't use it to enumerate accounts).
 *
 * The transporter is created lazily and cached for the process
 * lifetime — nodemailer keeps a small connection pool internally,
 * so creating it on every call would be wasteful.
 */

let transporter: nodemailer.Transporter | null = null;
let transporterTried = false;

function getTransporter(): nodemailer.Transporter | null {
  if (transporterTried) return transporter;
  transporterTried = true;

  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    // 587 = STARTTLS upgrade. 465 = implicit TLS. Brevo's relay uses
    // 587, so secure is false by default — nodemailer negotiates the
    // TLS upgrade after EHLO.
    secure: port === 465,
    auth: { user, pass }
  });
  return transporter;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text fallback. Recommended for deliverability —
   *  some spam filters down-weight HTML-only mail. */
  text?: string;
  /** Reply-To header — e.g. the visitor's address on a contact-form
   *  notification, so "Reply" in the inbox goes to them, not to us. */
  replyTo?: string;
}

export interface SendMailResult {
  ok: boolean;
  reason?: string;
}

export async function sendMail(opts: SendMailOptions): Promise<SendMailResult> {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] SMTP not configured — dropping mail to', opts.to, ':', opts.subject);
    return { ok: false, reason: 'unconfigured' };
  }

  // Envelope sender must stay on a domain the relay is authenticated for
  // (SPF/DKIM); humans reply to the app's public address instead.
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? getAppContactEmail();
  const fromName = process.env.SMTP_FROM_NAME ?? 'OneShopLab';

  try {
    await t.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      replyTo: opts.replyTo ?? getAppContactEmail()
    });
    return { ok: true };
  } catch (e) {
    console.error('[mailer] sendMail failed for', opts.to, e);
    return { ok: false, reason: 'send_failed' };
  }
}
