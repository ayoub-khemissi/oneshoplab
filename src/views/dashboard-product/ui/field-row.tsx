import { useTranslations } from 'next-intl';
import { RetryableGenerateButton } from '@/features/retryable-generate';
import { FieldViewProvider } from '@/shared/ui';

export function FieldRow({
  field,
  hasHistory,
  available = true,
  children
}: {
  field: 'title' | 'description' | 'tags' | 'images';
  hasHistory: boolean;
  available?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Wrap both the FieldSwap (in `children`) and the Regenerate
    // button in a shared per-field view context so clicking
    // Regenerate can flip this section to AI without disturbing
    // sibling sections.
    <FieldViewProvider>
      <div className="flex flex-col gap-2 pb-5 last:pb-0 border-b last:border-b-0 border-[var(--border)]">
        {children}
        <div className="flex justify-end">
          <RetryableGenerateButton field={field} hasHistory={hasHistory} available={available} />
        </div>
      </div>
    </FieldViewProvider>
  );
}

export function NoLatestGen() {
  const t = useTranslations('Product');
  return <p className="text-sm text-[var(--muted)] italic">{t('noLatestGeneration')}</p>;
}
