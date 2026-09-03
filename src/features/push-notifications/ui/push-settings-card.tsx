'use client';

import { Card } from '@heroui/react';
import { Bell, BellOff, Share, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePushSubscription } from '../model/use-push-subscription';

/**
 * "Notifications on this device", in the account settings.
 *
 * Push is per device, not per account: the merchant may want it on their phone
 * and not on the laptop they leave open, so the card says which device it is
 * talking about and reports the browser's own state rather than pretending to
 * own it — a permission refused in Chrome can only be undone in Chrome.
 */
export function PushSettingsCard() {
  const t = useTranslations('Push');
  const { status, isBusy, enable, disable } = usePushSubscription();

  if (status === 'loading') return null;

  const isOn = status === 'on';
  const canToggle = status === 'on' || status === 'off' || status === 'prompt';

  return (
    <Card variant="secondary" className="flex flex-col gap-3 p-5" data-testid="push-settings">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            {isOn ? (
              <Bell className="size-4 text-[var(--accent)]" aria-hidden />
            ) : (
              <BellOff className="size-4 text-[var(--muted)]" aria-hidden />
            )}
            {t('settingsTitle')}
          </span>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t('settingsLead')}</p>
        </div>

        {canToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            aria-label={t('settingsTitle')}
            disabled={isBusy}
            data-testid="push-toggle"
            onClick={() => void (isOn ? disable() : enable())}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              isOn ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            {/* Anchored left: without it the knob starts from its static
                position — centred, because a button centres its inline
                content — and the "on" state pushed it past the track. */}
            <span
              className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
                isOn ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        ) : null}
      </div>

      {status === 'denied' ? (
        <p className="text-xs leading-relaxed text-[var(--muted)]">{t('deniedHint')}</p>
      ) : null}
      {status === 'ios_install' ? (
        <p className="inline-flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]">
          <Share className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('iosInstallHint')}
        </p>
      ) : null}
      {status === 'unavailable' ? (
        <p className="inline-flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]">
          <Smartphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('unavailableHint')}
        </p>
      ) : null}
    </Card>
  );
}
