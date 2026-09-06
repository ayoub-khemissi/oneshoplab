import { useTranslations } from 'next-intl';
import { RetryableGenerateButton } from '@/features/retryable-generate';
import { FieldViewProvider } from '@/shared/ui';

export function FieldRow({
  field,
  hasHistory,
  available = true,
  apply,
  tour,
  children
}: {
  field: 'title' | 'description' | 'tags' | 'images';
  /** Anchor for the first-store walkthrough (@/features/guided-tour). */
  tour?: string;
  hasHistory: boolean;
  available?: boolean;
  /** "Apply to my store" for the latest generation of this field — the whole
   *  point of generating one, and it used to live only in the history
   *  accordion at the bottom of the page. */
  apply?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // Wrap both the FieldSwap (in `children`) and the Regenerate
    // button in a shared per-field view context so clicking
    // Regenerate can flip this section to AI without disturbing
    // sibling sections.
    <FieldViewProvider>
      <div
        id={`field-${field}`}
        data-tour={tour}
        className="flex flex-col gap-2 pb-5 last:pb-0 border-b last:border-b-0 border-[var(--border)]"
      >
        {children}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {apply}
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
