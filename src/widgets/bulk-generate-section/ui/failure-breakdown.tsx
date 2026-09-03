'use client';

import { CheckCircle2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FieldKey, ProductBulkState } from '../model/types';

export interface FailureBreakdownProps {
  perProduct: Record<string, ProductBulkState>;
  productTitleById: Record<string, string>;
}

// Atomic UI for the post-completion banner.
export function FailureBreakdown({ perProduct, productTitleById }: FailureBreakdownProps) {
  const t = useTranslations('BulkGenerate');
  const fieldLabel: Record<FieldKey, string> = {
    title: t('fieldTitle'),
    description: t('fieldDescription'),
    tags: t('fieldTags'),
    alt: t('fieldAlt'),
    images: t('fieldImages')
  };

  const rows = Object.entries(perProduct).filter(([, state]) =>
    Object.values(state.fields).some((v) => v && v !== 'done')
  );
  if (rows.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2 text-xs max-h-72 overflow-y-auto">
      {rows.map(([productId, state]) => (
        <div key={productId} className="flex flex-col gap-1">
          <span className="font-medium text-[var(--foreground)]">
            {productTitleById[productId] ?? productId}
          </span>
          <ul className="flex flex-col gap-1 pl-3">
            {(['title', 'description', 'tags', 'images'] as const).map((f) => {
              const outcome = state.fields[f];
              if (!outcome) return null;
              if (outcome === 'done') {
                return (
                  <li key={f} className="text-[var(--success)] inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3" /> {fieldLabel[f]}
                  </li>
                );
              }
              return (
                <li key={f} className="text-[var(--danger)] inline-flex items-start gap-1.5">
                  <X className="size-3 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium">{fieldLabel[f]}</span>
                    <span className="text-[var(--muted)]"> · {outcome.error}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
