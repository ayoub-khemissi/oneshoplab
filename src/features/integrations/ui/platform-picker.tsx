'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlatformLogo } from '@/shared/ui';
import { INTEGRATION_PLATFORMS, type IntegrationPlatform } from '../model/types';

const PLATFORM_NAMES: Record<IntegrationPlatform, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  wix: 'Wix'
};

export function platformName(platform: IntegrationPlatform): string {
  return PLATFORM_NAMES[platform];
}

export function PlatformPicker({
  value,
  detected,
  onChange
}: {
  value: IntegrationPlatform | null;
  /** Platform found by the audit — labelled so the merchant trusts the preselection. */
  detected: IntegrationPlatform | null;
  onChange: (platform: IntegrationPlatform) => void;
}) {
  const t = useTranslations('Integrations');
  return (
    <div role="radiogroup" aria-label={t('step1Title')} className="grid gap-3 sm:grid-cols-3">
      {INTEGRATION_PLATFORMS.map((platform) => {
        const selected = value === platform;
        return (
          <button
            key={platform}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(platform)}
            className={`relative flex items-center gap-3 p-4 rounded-lg border text-left transition-colors ${
              selected
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] hover:border-[var(--accent)]/60'
            }`}
          >
            <PlatformLogo platform={platform} className="size-7 shrink-0" />
            <span className="flex flex-col min-w-0">
              <span className="text-sm font-semibold">{PLATFORM_NAMES[platform]}</span>
              {detected === platform ? (
                <span className="text-[11px] text-[var(--muted)]">{t('platformDetected')}</span>
              ) : null}
            </span>
            {selected ? (
              <Check className="size-4 text-[var(--accent)] absolute top-3 right-3" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
