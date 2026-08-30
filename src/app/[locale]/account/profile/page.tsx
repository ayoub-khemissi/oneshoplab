import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AccountDeleteForm, ProfileNameForm, ProfilePasswordForm } from '@/features/account';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'cancelling'];

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const t = await getTranslations('Profile');

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session.user.id)
  });
  const hasActiveSubscription = sub != null && ACTIVE_SUB_STATUSES.includes(sub.status);

  // Translations are pulled here (server) and pushed into the client forms
  // as `copy` props so the form components stay locale-agnostic.
  const passwordErrors: Record<string, string> = {
    wrong_password: t('errorWrongPassword'),
    password_mismatch: t('errorPasswordMismatch'),
    password_weak: t('errorPasswordWeak'),
    missing_fields: t('errorMissingFields'),
    no_password: t('errorGeneric'),
    unauthorized: t('errorGeneric'),
    generic: t('errorGeneric')
  };
  const deleteErrors: Record<string, string> = {
    missing_email: t('errorMissingEmail'),
    email_mismatch: t('errorEmailMismatch'),
    active_subscription: t('errorActiveSubscription'),
    unauthorized: t('errorGeneric'),
    generic: t('errorGeneric')
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl leading-relaxed">{t('subtitle')}</p>
      </header>

      <ProfileNameForm
        initialName={session.user.name ?? ''}
        email={session.user.email ?? ''}
        copy={{
          identityTitle: t('identityTitle'),
          emailLabel: t('emailLabel'),
          emailHint: t('emailHint'),
          nameLabel: t('nameLabel'),
          namePlaceholder: t('namePlaceholder'),
          saveButton: t('saveButton'),
          saved: t('saved')
        }}
      />

      <ProfilePasswordForm
        copy={{
          passwordTitle: t('passwordTitle'),
          currentPasswordLabel: t('currentPasswordLabel'),
          newPasswordLabel: t('newPasswordLabel'),
          newPasswordHint: t('newPasswordHint'),
          confirmNewPasswordLabel: t('confirmNewPasswordLabel'),
          changePasswordButton: t('changePasswordButton'),
          saved: t('saved'),
          errors: passwordErrors
        }}
      />

      <AccountDeleteForm
        hasActiveSubscription={hasActiveSubscription}
        email={session.user.email ?? ''}
        copy={{
          dangerTitle: t('dangerTitle'),
          dangerBody: t('dangerBody'),
          dangerActiveSub: t('dangerActiveSub'),
          deleteEmailConfirmLabel: t('deleteEmailConfirmLabel'),
          deleteEmailConfirmHint: t('deleteEmailConfirmHint', {
            email: session.user.email ?? ''
          }),
          deleteAccountButton: t('deleteAccountButton'),
          errors: deleteErrors
        }}
      />
    </div>
  );
}
