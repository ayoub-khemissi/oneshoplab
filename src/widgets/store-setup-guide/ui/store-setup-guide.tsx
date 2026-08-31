import { ArrowRight, Check, Circle, Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface StoreSetupGuideProps {
  projectId: string;
  /** A plugin or an app is talking to us for this store. */
  connected: boolean;
  /** At least one change has actually landed in the store. */
  applied: boolean;
  /** The storefront could not be read (blocked scraper, no public catalog).
   *  The connection is the fix, so the card says that instead of an error. */
  auditFailed?: boolean;
}

const TOTAL_STEPS = 3;

/**
 * The merchant's next move, spelled out. Everything before the connection —
 * the audit, the generations — reads as a report they have to act on
 * themselves; a connected store is what turns OneShopLab into something that
 * writes back. So the site dashboard carries the path until it is walked:
 * audit (already done by the time this renders), connect, apply once.
 *
 * It disappears on its own — no dismiss button, because there is nothing left
 * to dismiss once the last step is ticked.
 */
export function StoreSetupGuide({
  projectId,
  connected,
  applied,
  auditFailed = false
}: StoreSetupGuideProps) {
  const t = useTranslations('Onboarding');
  if (connected && applied) return null;

  // Nothing could be read from the outside: there is no report to comment on,
  // and calling it a failure only teaches the merchant that we don't work. The
  // card takes over the whole moment and points at the one thing that fixes it.
  const rescue = auditFailed && !connected;
  const current = connected ? 3 : 2;
  const href = connected
    ? `/dashboard/sites/${projectId}?tab=products`
    : `/dashboard/sites/${projectId}?tab=integrations`;

  return (
    <section
      data-testid="store-setup-guide"
      data-step={rescue ? 'rescue' : current}
      className="flex flex-col gap-4 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4 md:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--accent)]" />
            </span>
            {rescue ? t('nextStepEyebrow') : t('stepCounter', { n: current, total: TOTAL_STEPS })}
          </span>
          <h2 className="text-lg font-semibold tracking-tight">
            {rescue ? t('rescueTitle') : connected ? t('applyTitle') : t('connectTitle')}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            {rescue ? t('rescueLead') : connected ? t('applyLead') : t('connectLead')}
          </p>
        </div>
        <Link
          href={href}
          data-testid="store-setup-cta"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
        >
          {connected ? t('ctaApply') : t('ctaConnect')}
          {connected ? (
            <ArrowRight className="size-4" aria-hidden />
          ) : (
            <Plug className="size-4" aria-hidden />
          )}
        </Link>
      </div>

      {rescue ? null : (
        <ol className="flex flex-col gap-2 border-t border-[var(--accent)]/20 pt-3 text-sm">
          <GuideStep label={t('stepAudit')} done />
          <GuideStep label={t('stepConnect')} done={connected} active={!connected} />
          <GuideStep label={t('stepApply')} done={applied} active={connected} />
        </ol>
      )}
    </section>
  );
}

function GuideStep({ label, done, active }: { label: string; done: boolean; active?: boolean }) {
  return (
    <li className="flex items-center gap-2.5">
      {done ? (
        <Check className="size-4 shrink-0 text-[var(--success)]" aria-hidden />
      ) : (
        <Circle
          className={`size-4 shrink-0 ${active ? 'text-[var(--accent)]' : 'text-[var(--muted)]/50'}`}
          aria-hidden
        />
      )}
      <span
        className={
          done
            ? 'text-[var(--muted)]'
            : active
              ? 'font-medium text-[var(--foreground)]'
              : 'text-[var(--muted)]'
        }
      >
        {label}
      </span>
    </li>
  );
}
