import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ModelPreferencesForm } from '@/components/model-preferences-form';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AccountPreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const t = await getTranslations('Preferences');

  return (
    <main className="px-6 md:px-10 pb-10 max-w-3xl w-full mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2 mt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl leading-relaxed">
          {t('subtitle')}
        </p>
      </header>

      <ModelPreferencesForm
        initialChatModel={session.user.preferredChatModel}
        initialImageQuality={session.user.preferredImageQuality}
        copy={{
          chatLabel: t('chatLabel'),
          chatHint: t('chatHint'),
          imageLabel: t('imageLabel'),
          imageHint: t('imageHint'),
          saveButton: t('save'),
          saved: t('saved'),
          perGen: t('perGen'),
          perImage: t('perImage')
        }}
      />
    </main>
  );
}
