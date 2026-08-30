'use client';

import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  RETURN_PARAM_KEYS,
  shopifyReturnError,
  wixReturnError,
  type IntegrationReturn
} from '../lib/return-params';
import type { IntegrationPlatform } from '../model/types';

/**
 * Banner for the OAuth return (`?connected=` / `?warning=` / `?error=`). The
 * params are stripped from the address bar once shown so a reload or a
 * shared link does not replay the message; the banner itself stays until
 * dismissed. An `error` carries no platform: the selected one decides the copy.
 */
export function ReturnNotice({
  notice,
  platform
}: {
  notice: IntegrationReturn;
  platform: IntegrationPlatform | null;
}) {
  const t = useTranslations('Integrations');
  const [open, setOpen] = useState(notice.kind !== 'none');

  useEffect(() => {
    if (notice.kind === 'none') return;
    const url = new URL(window.location.href);
    for (const key of RETURN_PARAM_KEYS) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.toString());
  }, [notice]);

  if (!open || notice.kind === 'none') return null;

  const errorPlatform = notice.kind === 'error' && platform === 'wix' ? 'wix' : 'shopify';
  const tone =
    notice.kind === 'error'
      ? 'border-[var(--danger)]/40 bg-[var(--danger)]/5 text-[var(--danger)]'
      : notice.warning
        ? 'border-[var(--warning)]/60 bg-[var(--warning)]/15'
        : 'border-[var(--success)]/40 bg-[var(--success)]/5';
  const message =
    notice.kind === 'error'
      ? errorPlatform === 'wix'
        ? t(`wix.return.error.${wixReturnError(notice.reason)}`)
        : t(`shopifyApp.return.error.${shopifyReturnError(notice.reason)}`)
      : notice.platform === 'wix'
        ? t('wix.return.success')
        : notice.warning
          ? t('shopifyApp.return.webhooksFailed')
          : t('shopifyApp.return.success');

  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      data-testid="integration-return"
      data-kind={notice.kind === 'connected' && notice.warning ? 'warning' : notice.kind}
      className={`rounded-md border p-4 flex items-start gap-3 text-sm ${tone}`}
    >
      {notice.kind === 'error' || notice.warning ? (
        <AlertTriangle className="size-5 shrink-0 mt-0.5" aria-hidden />
      ) : (
        <CheckCircle2 className="size-5 shrink-0 mt-0.5 text-[var(--success)]" aria-hidden />
      )}
      <span className="flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={t('returnDismiss')}
        className="shrink-0 rounded p-0.5 hover:bg-[var(--default)]/60"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
