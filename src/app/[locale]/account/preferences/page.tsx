import { resolveChatModelId } from '@/entities/ai-model';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { AccountBulkPrefsForm } from '@/features/bulk-generate';
import { ModelPreferencesForm } from '@/features/model-preferences';
import { Link } from '@/i18n/navigation';
import { auth } from '@/lib/auth';
import { resolveBulkPrefs } from '@/features/bulk-generate';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function AccountPreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const t = await getTranslations('Preferences');
  const tb = await getTranslations('BulkGenerate');
  const plan = (session.user.plan ?? 'free') as string;
  const canBulk = plan === 'pro' || plan === 'scale';

  const userRow = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { defaultBulkPrefs: true }
  });
  const hasDefault = userRow?.defaultBulkPrefs != null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl leading-relaxed">{t('subtitle')}</p>
      </header>

      <ModelPreferencesForm
        initialChatModel={resolveChatModelId(session.user.preferredChatModel)}
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

      {canBulk ? (
        <AccountBulkPrefsForm
          initialPrefs={resolveBulkPrefs(userRow?.defaultBulkPrefs ?? null)}
          initialHasDefault={hasDefault}
        />
      ) : (
        <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-5 flex flex-col gap-2">
          <h2 className="text-base font-semibold">{tb('configAccountTitle')}</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">{tb('upgradeHint')}</p>
          <Link
            href="/pricing"
            className="self-start mt-1 px-3 py-1.5 rounded-md text-sm font-medium border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 inline-flex items-center gap-1.5"
          >
            {tb('upgradeCta')}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
