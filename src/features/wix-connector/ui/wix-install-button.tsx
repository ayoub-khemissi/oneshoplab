'use client';

import { Spinner } from '@heroui/react';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { getWixInstallUrlAction, type WixActionError } from '../api/actions';

/**
 * "Install on Wix": asks the server for the install route (ownership +
 * configuration checked there), then navigates in the same tab so the state
 * cookie and the session travel with the merchant to Wix and back.
 */
export function WixInstallButton({ projectId, locale }: { projectId: string; locale: string }) {
  const t = useTranslations('Integrations.wix');
  const [error, setError] = useState<WixActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function install() {
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('locale', locale);
    setError(null);
    startTransition(async () => {
      const res = await getWixInstallUrlAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.assign(res.url);
    });
  }

  return (
    <div
      data-testid="wix-install"
      className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-5 flex flex-col gap-3"
    >
      <span className="text-base font-semibold">{t('installTitle')}</span>
      <p className="text-sm text-[var(--muted)] leading-relaxed">{t('installBody')}</p>
      <button
        type="button"
        onClick={install}
        disabled={pending}
        className="self-start inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-semibold hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Spinner size="sm" /> : null}
        {pending ? t('installing') : t('install')}
        {!pending ? <ExternalLink className="size-4" aria-hidden /> : null}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {t(`installError.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
