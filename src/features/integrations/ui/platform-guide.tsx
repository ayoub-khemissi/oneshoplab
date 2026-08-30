'use client';

import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { CopyButton } from '@/shared/ui';
import { setIntegrationInterestAction } from '../api/actions';
import {
  COMING_SOON,
  ESTIMATED_MINUTES,
  GUIDE_STEPS,
  GUIDE_VALUES,
  screenshotPath,
  type GuideStep
} from '../lib/guide-steps';
import type { IntegrationInterestMap, IntegrationPlatform } from '../model/types';
import { platformName } from './platform-picker';

export function PlatformGuide({
  projectId,
  platform,
  siteKeyPlaintext,
  interest
}: {
  projectId: string;
  platform: IntegrationPlatform | null;
  /** Freshly generated key (step 3) — shown in the "paste it" step while visible. */
  siteKeyPlaintext: string | null;
  interest: IntegrationInterestMap;
}) {
  const t = useTranslations('Integrations');
  if (!platform) {
    return <p className="text-sm text-[var(--muted)] italic">{t('chooseFirst')}</p>;
  }
  const steps = GUIDE_STEPS[platform];
  return (
    <div className="flex flex-col gap-4">
      {COMING_SOON[platform] ? (
        <ComingSoonNotice
          projectId={projectId}
          platform={platform}
          initialValue={platform === 'shopify' || platform === 'wix' ? !!interest[platform] : false}
        />
      ) : null}
      {steps.length > 0 ? (
        <>
          <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            {t('estimated', { minutes: ESTIMATED_MINUTES[platform] })}
          </p>
          <ol className={`flex flex-col gap-5 ${COMING_SOON[platform] ? 'opacity-60' : ''}`}>
            {steps.map((step) => (
              <GuideStepItem
                key={step.n}
                platform={platform}
                step={step}
                siteKeyPlaintext={siteKeyPlaintext}
              />
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}

function GuideStepItem({
  platform,
  step,
  siteKeyPlaintext
}: {
  platform: IntegrationPlatform;
  step: GuideStep;
  siteKeyPlaintext: string | null;
}) {
  const t = useTranslations('Integrations');
  const value =
    step.valueKind === 'siteKey'
      ? siteKeyPlaintext
      : step.valueKind
        ? GUIDE_VALUES[step.valueKind]
        : null;
  return (
    <li className="grid gap-3 md:grid-cols-[1fr_260px] md:gap-5">
      <div className="flex gap-3">
        <span className="size-7 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-semibold inline-flex items-center justify-center shrink-0">
          {step.n}
        </span>
        <div className="flex flex-col gap-2 min-w-0">
          <p className="text-sm font-semibold leading-7">
            {t(`guide.${platform}.step${step.n}.title`)}
          </p>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t(`guide.${platform}.step${step.n}.body`)}
          </p>
          {step.valueKind ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                {t(`valueLabel.${step.valueKind}`)}
              </span>
              {value ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs font-mono px-2 py-1 rounded bg-[var(--default)]/60 border border-[var(--border)] break-all">
                    {value}
                  </code>
                  <CopyButton value={value} label={t('copy')} copiedLabel={t('copied')} />
                </div>
              ) : (
                <span className="text-xs text-[var(--muted)] italic">{t('siteKeyPending')}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <img
        src={screenshotPath(platform, step.n)}
        alt={t('screenshotAlt', { n: step.n })}
        width={800}
        height={450}
        loading="lazy"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--default)]/40"
      />
    </li>
  );
}

function ComingSoonNotice({
  projectId,
  platform,
  initialValue
}: {
  projectId: string;
  platform: IntegrationPlatform;
  initialValue: boolean;
}) {
  const t = useTranslations('Integrations');
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !value;
    setValue(next);
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('platform', platform);
    fd.set('value', next ? '1' : '0');
    startTransition(async () => {
      const res = await setIntegrationInterestAction(fd);
      if (!res.ok) setValue(!next);
    });
  }

  return (
    <div
      role="status"
      className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t('comingSoonTitle')}</span>
        <span className="text-xs text-[var(--muted)] leading-relaxed">
          {t('comingSoonBody', { platform: platformName(platform) })}
        </span>
      </div>
      <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={value}
          disabled={pending}
          onChange={toggle}
          className="size-4 accent-[var(--accent)]"
        />
        {value ? t('notifySaved') : t('notifyMe')}
      </label>
    </div>
  );
}
