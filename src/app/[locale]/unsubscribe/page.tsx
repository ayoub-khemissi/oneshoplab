import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getAppContactEmail } from '@/lib/app-contact';
import { verifyOptOutToken } from '@/features/cold-outreach';
import { db } from '@/lib/db';
import { leadAttempts, leads } from '@/lib/db/schema';

/**
 * Cold-outreach unsubscribe handler. Reached from the link in the
 * footer of cold mails (FR + EN); the token is an HMAC of the lead id.
 *
 * Side effect on render: if the token is valid AND the lead isn't
 * already dead, flip status to 'dead' and append a lead_attempts row
 * for traceability. Idempotent so a recipient clicking twice (or a
 * mail-client prefetch) doesn't double-write.
 *
 * Not internationalised through next-intl because the message is only
 * ever reached from FR/EN cold mails — we hardcode both copies inline.
 * Unknown locales fall back to EN.
 *
 * Robots: noindex — this URL embeds a personal token and search engines
 * shouldn't crawl/preserve it.
 */

export const metadata: Metadata = {
  title: 'Unsubscribe — OneShopLab',
  robots: { index: false, follow: false }
};

const copyFor = (email: string) =>
  ({
    fr: {
      successTitle: 'Désinscription confirmée',
      successLead: 'Vous ne recevrez plus de message de notre part.',
      successBody: `Si c'était une erreur ou si vous avez une question, écrivez-nous à ${email} — un humain vous répondra.`,
      backHome: 'Retour à oneshoplab.com',
      alreadyTitle: 'Déjà désinscrit',
      alreadyBody: 'Cette adresse était déjà retirée de notre liste. Rien à faire.',
      errorTitle: 'Lien invalide ou expiré',
      errorBody: `Ce lien de désinscription n'est pas reconnu. Si vous souhaitez ne plus recevoir nos messages, écrivez-nous à ${email} — nous traiterons la demande manuellement.`
    },
    en: {
      successTitle: 'Unsubscribe confirmed',
      successLead: "You won't receive any further messages from us.",
      successBody: `If this was a mistake or you have a question, drop us a line at ${email} — a human will reply.`,
      backHome: 'Back to oneshoplab.com',
      alreadyTitle: 'Already unsubscribed',
      alreadyBody: 'This address was already off our list. Nothing to do.',
      errorTitle: 'Invalid or expired link',
      errorBody: `This unsubscribe link is not recognised. If you want to stop receiving our messages, write to ${email} — we will process it manually.`
    }
  }) satisfies Record<string, Record<string, string>>;

type Outcome = 'success' | 'already' | 'error';

async function processOptOut(token: string | undefined): Promise<Outcome> {
  if (!token) return 'error';
  let leadId: string | null;
  try {
    leadId = verifyOptOutToken(token);
  } catch {
    // Throws when COLD_OPTOUT_SECRET is misconfigured. Treat the same
    // as an invalid token from the user's perspective; the server log
    // will surface the misconfig for the operator.
    return 'error';
  }
  if (!leadId) return 'error';

  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
    columns: { id: true, status: true }
  });
  if (!lead) return 'error';
  if (lead.status === 'dead') return 'already';

  await db.update(leads).set({ status: 'dead' }).where(eq(leads.id, lead.id));
  await db.insert(leadAttempts).values({
    id: randomUUID(),
    leadId: lead.id,
    channel: 'email',
    payload: JSON.stringify({ event: 'unsubscribe' }),
    response: 'opt-out'
  });
  return 'success';
}

export default async function UnsubscribePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { locale } = await params;
  const { t } = await searchParams;
  const lang: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const copy = copyFor(getAppContactEmail())[lang];

  const outcome = await processOptOut(t);

  const title =
    outcome === 'success'
      ? copy.successTitle
      : outcome === 'already'
        ? copy.alreadyTitle
        : copy.errorTitle;

  const lead = outcome === 'success' ? copy.successLead : null;
  const body =
    outcome === 'success'
      ? copy.successBody
      : outcome === 'already'
        ? copy.alreadyBody
        : copy.errorBody;

  return (
    <main className="flex-1 px-4 py-16 max-w-xl w-full mx-auto">
      <div className="flex flex-col gap-4 text-center">
        <div
          aria-hidden
          className={`mx-auto inline-flex items-center justify-center w-12 h-12 rounded-full text-xl ${
            outcome === 'error'
              ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
              : 'bg-[var(--success)]/15 text-[var(--success)]'
          }`}
        >
          {outcome === 'error' ? '!' : '✓'}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {lead ? <p className="text-base text-[var(--foreground)]">{lead}</p> : null}
        <p className="text-sm text-[var(--muted)] leading-relaxed">{body}</p>
        <div className="pt-4">
          <Link
            href={`/${lang}`}
            className="inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
          >
            ← {copy.backHome}
          </Link>
        </div>
      </div>
    </main>
  );
}
