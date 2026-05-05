import { Card } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import {
  changePasswordAction,
  deleteAccountAction,
  updateUserProfileAction
} from '@/lib/auth-actions';
import { db } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'cancelling'];

export default async function ProfilePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const params = await searchParams;
  const t = await getTranslations('Profile');

  // Active subscription guard surfaced on the delete CTA so the merchant
  // doesn't get a hidden 4xx after typing their password — disable
  // proactively and explain why.
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session.user.id)
  });
  const hasActiveSubscription =
    sub != null && ACTIVE_SUB_STATUSES.includes(sub.status);

  const banner = bannerForParams(params, t);

  return (
    <main className="px-6 md:px-10 pb-10 max-w-3xl w-full mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2 mt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl leading-relaxed">
          {t('subtitle')}
        </p>
      </header>

      {banner ? <Banner kind={banner.kind} text={banner.text} /> : null}

      {/* Identity section --------------------------------------------------- */}
      <Card variant="secondary" className="p-5 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--muted)]">
          {t('identityTitle')}
        </h2>
        <form action={updateUserProfileAction} className="flex flex-col gap-3">
          <Field label={t('emailLabel')}>
            {/* Email isn't editable — surfaced read-only because changing it
                would require re-verifying the new address, which we don't
                support yet. Stripe customer email stays in sync via webhook. */}
            <input
              type="email"
              value={session.user.email ?? ''}
              readOnly
              disabled
              className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--default)]/30 text-sm cursor-not-allowed"
            />
            <p className="text-xs text-[var(--muted)]">{t('emailHint')}</p>
          </Field>
          <Field label={t('nameLabel')}>
            <input
              type="text"
              name="name"
              defaultValue={session.user.name ?? ''}
              maxLength={100}
              placeholder={t('namePlaceholder')}
              className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition"
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t('saveButton')}
            </button>
          </div>
        </form>
      </Card>

      {/* Password section --------------------------------------------------- */}
      <Card variant="secondary" className="p-5 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--muted)]">
          {t('passwordTitle')}
        </h2>
        <form action={changePasswordAction} className="flex flex-col gap-3">
          <Field label={t('currentPasswordLabel')}>
            <input
              type="password"
              name="currentPassword"
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition"
            />
          </Field>
          <Field label={t('newPasswordLabel')}>
            <input
              type="password"
              name="newPassword"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition"
            />
            <p className="text-xs text-[var(--muted)]">{t('newPasswordHint')}</p>
          </Field>
          <Field label={t('confirmPasswordLabel')}>
            <input
              type="password"
              name="confirmPassword"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition"
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t('changePasswordButton')}
            </button>
          </div>
        </form>
      </Card>

      {/* Danger zone -------------------------------------------------------- */}
      <Card
        variant="secondary"
        className="p-5 flex flex-col gap-3 border-[var(--danger)]/40"
      >
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--danger)]">
          {t('dangerTitle')}
        </h2>
        <p className="text-sm text-[var(--muted)]">{t('dangerBody')}</p>
        {hasActiveSubscription ? (
          <p className="text-xs text-[var(--warning)] inline-flex items-start gap-1.5">
            <AlertCircle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
            {t('dangerActiveSub')}
          </p>
        ) : null}
        <form action={deleteAccountAction} className="flex flex-col gap-3">
          <Field label={t('confirmPasswordLabel')}>
            <input
              type="password"
              name="password"
              required
              disabled={hasActiveSubscription}
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-[var(--danger)]/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={hasActiveSubscription}
              className="px-4 py-2 rounded-md bg-[var(--danger)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('deleteAccountButton')}
            </button>
          </div>
        </form>
      </Card>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--foreground)]">{label}</span>
      {children}
    </label>
  );
}

function Banner({
  kind,
  text
}: {
  kind: 'success' | 'error';
  text: string;
}) {
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle;
  const cls =
    kind === 'success'
      ? 'bg-[var(--success)]/10 border-[var(--success)]/30 text-[var(--success)]'
      : 'bg-[var(--danger)]/10 border-[var(--danger)]/30 text-[var(--danger)]';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md border p-3 text-sm flex items-start gap-2 ${cls}`}>
      <Icon className="size-4 shrink-0 mt-0.5" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

function bannerForParams(
  params: { saved?: string; error?: string },
  t: (key: string) => string
): { kind: 'success' | 'error'; text: string } | null {
  if (params.saved === 'password') return { kind: 'success', text: t('passwordSaved') };
  if (!params.error) return null;
  switch (params.error) {
    case 'wrong_password':
      return { kind: 'error', text: t('errorWrongPassword') };
    case 'password_mismatch':
      return { kind: 'error', text: t('errorPasswordMismatch') };
    case 'password_weak':
      return { kind: 'error', text: t('errorPasswordWeak') };
    case 'missing_fields':
      return { kind: 'error', text: t('errorMissingFields') };
    case 'missing_password':
      return { kind: 'error', text: t('errorMissingPassword') };
    case 'active_subscription':
      return { kind: 'error', text: t('errorActiveSubscription') };
    default:
      return { kind: 'error', text: t('errorGeneric') };
  }
}
