'use client';

import { Spinner } from '@heroui/react';
import { AlertTriangle, Check, Clock, Sparkles, Store, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { sendAllGenerationsAction } from '../api/send-all';
import type { RecapRow, RecapState } from '../lib/product-recap';

const ICONS: Record<RecapState, typeof Check> = {
  to_apply: Sparkles,
  sending: Clock,
  applied: Check,
  conflict: AlertTriangle,
  failed: XCircle
};

const TONES: Record<RecapState, string> = {
  to_apply: 'text-[var(--accent)]',
  sending: 'text-[var(--muted)]',
  applied: 'text-[var(--success)]',
  conflict: 'text-[var(--warning,var(--danger))]',
  failed: 'text-[var(--danger)]'
};

/**
 * One line per generated field: what it is, and who is waiting on it. The page
 * used to answer neither — the store-side banner counts only what has already
 * been sent, so a rewritten set of tags nobody applied appeared nowhere at all.
 */
export function ProductRecapCard({
  rows,
  projectId,
  productId
}: {
  rows: RecapRow[];
  projectId: string;
  productId: string;
}) {
  const t = useTranslations('ProductRecap');
  const format = useFormatter();
  const router = useRouter();
  const [sent, setSent] = useState<number | null>(null);
  const [busy, startTransition] = useTransition();

  const toApply = rows.filter((r) => r.state === 'to_apply').length;

  function sendAll() {
    startTransition(async () => {
      const res = await sendAllGenerationsAction(projectId, productId);
      setSent(res.ok ? res.queued : 0);
      router.refresh();
    });
  }

  if (rows.length === 0) return null;

  return (
    <section
      data-testid="product-recap"
      data-to-apply={toApply}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-col gap-2"
    >
      <h2 className="text-sm font-semibold">
        {toApply > 0 ? t('titleToApply', { count: toApply }) : t('titleAllSent')}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const Icon = ICONS[row.state];
          return (
            <li key={row.field} className="flex flex-wrap items-center gap-2 text-xs">
              <Icon className={`size-3.5 shrink-0 ${TONES[row.state]}`} aria-hidden />
              <span className="font-medium">{t(`field.${row.field}`)}</span>
              <span className={TONES[row.state]}>{t(`state.${row.state}`)}</span>
              {row.atIso ? (
                <span className="text-[var(--muted)]">
                  {format.relativeTime(new Date(row.atIso))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {toApply > 0 ? (
        <button
          type="button"
          onClick={sendAll}
          disabled={busy}
          data-testid="recap-send-all"
          className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Spinner size="sm" /> : <Store className="size-3.5" aria-hidden />}
          {busy ? t('sendAllBusy') : t('sendAll', { count: toApply })}
        </button>
      ) : null}
      {sent !== null ? (
        <p role="status" className="text-xs text-[var(--success)]">
          {sent > 0 ? t('sendAllDone', { count: sent }) : t('sendAllNone')}
        </p>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {toApply > 0 ? t('hintToApply') : t('hintAllSent')}
        </p>
      )}
    </section>
  );
}
