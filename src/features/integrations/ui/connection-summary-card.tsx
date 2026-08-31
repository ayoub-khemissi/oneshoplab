'use client';

import { AlertTriangle, Check, CircleDashed, Plug, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ConnectionSummaryView, SummaryStepKey } from '../lib/connection-summary';

const TONE_CLASSES: Record<ConnectionSummaryView['tone'], string> = {
  ok: 'border-[var(--success)]/40 bg-[var(--success)]/5',
  warn: 'border-[var(--warning,var(--danger))]/40 bg-[var(--warning,var(--danger))]/5',
  danger: 'border-[var(--danger)]/40 bg-[var(--danger)]/5',
  idle: 'border-[var(--border)] bg-[var(--default)]/30'
};

const TONE_TEXT: Record<ConnectionSummaryView['tone'], string> = {
  ok: 'text-[var(--success)]',
  warn: 'text-[var(--warning,var(--danger))]',
  danger: 'text-[var(--danger)]',
  idle: 'text-[var(--muted)]'
};

/**
 * The state of this store's link, at the very top of the tab: connected or
 * not, and what is still missing. The steps mirror the wizard below, so the
 * card is a table of contents as much as a verdict.
 */
export function ConnectionSummaryCard({ summary }: { summary: ConnectionSummaryView }) {
  const t = useTranslations('Integrations');
  const { tone, state, steps, problem } = summary;

  const Icon =
    tone === 'ok' ? Check : tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : Plug;

  return (
    <section
      data-testid="connection-summary"
      data-tone={tone}
      data-state={state}
      className={`flex flex-col gap-3 rounded-lg border p-4 md:p-5 ${TONE_CLASSES[tone]}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${TONE_TEXT[tone]}`} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">{t(`summary.${state}Title`)}</h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            {problem ? t(`summary.problem.${problem}`) : t(`summary.${state}Lead`)}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 border-t border-[var(--border)]/60 pt-3 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
        {steps.map((s) => (
          <SummaryStepLine
            key={s.key}
            stepKey={s.key}
            done={s.done}
            label={t(`summary.step.${s.key}`)}
          />
        ))}
      </ul>
    </section>
  );
}

function SummaryStepLine({
  stepKey,
  done,
  label
}: {
  stepKey: SummaryStepKey;
  done: boolean;
  label: string;
}) {
  return (
    <li className="flex items-center gap-2" data-step={stepKey} data-done={done}>
      {done ? (
        <Check className="size-4 shrink-0 text-[var(--success)]" aria-hidden />
      ) : (
        <CircleDashed className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
      )}
      <span className={done ? 'text-[var(--muted)]' : 'font-medium'}>{label}</span>
    </li>
  );
}
