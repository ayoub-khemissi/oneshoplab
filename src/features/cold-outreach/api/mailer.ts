import nodemailer from 'nodemailer';
import { getAppContactEmail } from '@/shared/config';

/**
 * Cold-outreach mailer. Separate from `src/shared/mailer` (transactional
 * Brevo on oneshoplab.com) on purpose: cold sends go through Hostinger
 * SMTP on `get-oneshoplab.com` so a reputation hit on prospection never
 * bleeds into the app's transactional flow (password resets, receipts).
 *
 * Reads COLD_SMTP_HOST / COLD_SMTP_PORT / COLD_SMTP_USER /
 * COLD_SMTP_PASSWORD / COLD_SMTP_FROM_EMAIL / COLD_SMTP_FROM_NAME.
 * When any required var is missing, `sendColdMail` no-ops with
 * `{ ok: false, reason: 'unconfigured' }` so dry-run paths and CI keep
 * working without leaking creds.
 */

let transporter: nodemailer.Transporter | null = null;
let transporterTried = false;

function getTransporter(): nodemailer.Transporter | null {
  if (transporterTried) return transporter;
  transporterTried = true;

  const host = process.env.COLD_SMTP_HOST;
  const port = Number.parseInt(process.env.COLD_SMTP_PORT ?? '465', 10);
  const user = process.env.COLD_SMTP_USER;
  const pass = process.env.COLD_SMTP_PASSWORD;
  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    // Hostinger SMTP is 465 (implicit TLS). 587 (STARTTLS) also works but
    // 465 is what their docs recommend.
    secure: port === 465,
    auth: { user, pass }
  });
  return transporter;
}

export interface SendColdMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 List-Unsubscribe header for inbox providers (Gmail/Outlook
   *  show a native "Unsubscribe" button when this is present). */
  listUnsubscribe?: string;
  /** Reply-To override — useful if you want replies to land in a shared
   *  alias instead of the From mailbox. Defaults to From. */
  replyTo?: string;
}

export interface SendColdMailResult {
  ok: boolean;
  reason?: string;
  messageId?: string;
}

export async function sendColdMail(opts: SendColdMailOptions): Promise<SendColdMailResult> {
  const t = getTransporter();
  if (!t) {
    console.warn('[cold-mailer] COLD_SMTP_* not configured — dropping mail to', opts.to);
    return { ok: false, reason: 'unconfigured' };
  }

  const fromEmail = process.env.COLD_SMTP_FROM_EMAIL ?? getAppContactEmail();
  const fromName = process.env.COLD_SMTP_FROM_NAME ?? 'Youbi';

  const headers: Record<string, string> = {};
  if (opts.listUnsubscribe) {
    headers['List-Unsubscribe'] = opts.listUnsubscribe;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  try {
    const info = await t.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: opts.to,
      replyTo: opts.replyTo ?? fromEmail,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[cold-mailer] sendMail failed for', opts.to, e);
    return { ok: false, reason: (e as Error).message };
  }
}
