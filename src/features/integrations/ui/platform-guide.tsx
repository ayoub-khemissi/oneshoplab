'use client';

import { Clock, Download, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { CopyButton } from '@/shared/ui';
import { setIntegrationInterestAction } from '../api/actions';
import {
  buildSteps,
  ESTIMATED_MINUTES,
  GUIDE_VALUES,
  type GuideStep,
  WP_PLUGIN_ZIP_PATH
} from '../lib/guide-steps';
import type { IntegrationInterestMap, IntegrationPlatform } from '../model/types';
import { MOCK_VIEWS } from './mocks';
import { platformName } from './platform-picker';

export function PlatformGuide({
  projectId,
  platform,
  domain,
  pluginVersion,
  siteKeyPlaintext,
  interest,
  comingSoon
}: {
  projectId: string;
  platform: IntegrationPlatform | null;
  /** The widget decides from `isComingSoon(platform, …)` — the guide has no env access. */
  comingSoon: boolean;
  /** Project domain or URL — feeds the "Open" links of each step. */
  domain: string | null;
  pluginVersion: string | null;
  /** Freshly generated key (step 3) — shown in the "paste it" step while visible. */
  siteKeyPlaintext: string | null;
  interest: IntegrationInterestMap;
}) {
  const t = useTranslations('Integrations');
  if (!platform) {
    return <p className="text-sm text-[var(--muted)] italic">{t('chooseFirst')}</p>;
  }
  const steps = buildSteps({ platform, domain });
  return (
    <div className="flex flex-col gap-4">
      {comingSoon ? (
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
          <ol className={`flex flex-col gap-5 ${comingSoon ? 'opacity-60' : ''}`}>
            {steps.map((step) => (
              <GuideStepItem
                key={step.n}
                platform={platform}
                step={step}
                pluginVersion={pluginVersion}
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
  pluginVersion,
  siteKeyPlaintext
}: {
  platform: IntegrationPlatform;
  step: GuideStep;
  pluginVersion: string | null;
  siteKeyPlaintext: string | null;
}) {
  const t = useTranslations('Integrations');
  const MockView = MOCK_VIEWS[step.mock];
  const value =
    step.valueKind === 'siteKey'
      ? siteKeyPlaintext
      : step.valueKind
        ? GUIDE_VALUES[step.valueKind]
        : null;
  return (
    <li className="grid gap-3 md:grid-cols-2 md:items-center md:gap-8">
      <div className="flex gap-3">
        <span className="size-7 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-semibold inline-flex items-center justify-center shrink-0">
          {step.n}
        </span>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold leading-7">
              {t(`guide.${platform}.step${step.n}.title`)}
            </p>
            {step.openUrl ? (
              <a
                href={step.openUrl}
                target="_blank"
                rel="noopener"
                data-open-admin
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-xs font-medium hover:bg-[var(--default)]/60"
              >
                {t('openAdmin')}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t(`guide.${platform}.step${step.n}.body`)}
          </p>
          {platform === 'woocommerce' && step.n === 1 ? (
            <a
              href={WP_PLUGIN_ZIP_PATH}
              download
              data-download-plugin
              className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
            >
              <Download className="size-4" aria-hidden />
              {t('downloadPlugin')}
              {pluginVersion ? <span className="opacity-80">v{pluginVersion}</span> : null}
            </a>
          ) : null}
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
      <MockView />
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
