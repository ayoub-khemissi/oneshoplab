'use client';

import { Spinner } from '@heroui/react';
import { CheckCircle2, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { normalizeShopDomain, type ShopifyConnectionView } from '@/entities/shop-connection/client';
import { connectShopifyAction, type ShopifyActionError } from '../api/actions';
import { prefillShopDomain } from '../lib/prefill-domain';

const ERROR_KEYS: Record<ShopifyActionError, string> = {
  invalid_domain: 'invalid_domain',
  invalid_token: 'invalid_token',
  token_invalid: 'token_invalid',
  unreachable: 'unreachable',
  domain_mismatch: 'domain_mismatch',
  no_key: 'no_key',
  not_found: 'not_found',
  unauthorized: 'not_found',
  bad_request: 'invalid_domain'
};

const field =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';

/**
 * Wizard step 3 (Shopify): domain + Admin API token (+ optional API secret).
 * The token is sent once and never displayed again; an obviously invalid
 * domain is refused before any network call.
 */
export function ShopifyConnectForm({
  projectId,
  domain,
  onConnected
}: {
  projectId: string;
  /** Project domain or URL: prefills the shop domain when it is a myshopify host. */
  domain: string | null;
  onConnected: (connection: ShopifyConnectionView) => void;
}) {
  const t = useTranslations('Integrations.shopify');
  const [shopDomain, setShopDomain] = useState(() => prefillShopDomain(domain));
  const [error, setError] = useState<ShopifyActionError | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    if (!normalizeShopDomain(shopDomain)) {
      setError('invalid_domain');
      return;
    }
    const fd = new FormData(form);
    fd.set('projectId', projectId);
    startTransition(async () => {
      const res = await connectShopifyAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      form.reset();
      setDone(true);
      onConnected(res.connection);
    });
  }

  if (done) {
    return (
      <p
        data-testid="shopify-connect-success"
        className="text-sm inline-flex items-center gap-2 text-[var(--success)]"
      >
        <CheckCircle2 className="size-4" aria-hidden />
        {t('connectSuccess')}
      </p>
    );
  }

  return (
    <form onSubmit={submit} data-testid="shopify-connect-form" className="flex flex-col gap-4">
      <p className="text-sm text-[var(--muted)] leading-relaxed">{t('formIntro')}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('domainLabel')}</span>
        <input
          name="shopDomain"
          value={shopDomain}
          onChange={(e) => setShopDomain(e.target.value)}
          placeholder="ma-boutique.myshopify.com"
          autoComplete="off"
          spellCheck={false}
          required
          className={field}
        />
        <span className="text-xs text-[var(--muted)]">{t('domainHint')}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('tokenLabel')}</span>
        <input
          name="accessToken"
          type="password"
          autoComplete="off"
          required
          className={`${field} font-mono`}
        />
        <span className="text-xs text-[var(--muted)]">{t('tokenHint')}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          {t('secretLabel')}{' '}
          <span className="font-normal text-[var(--muted)]">({t('optional')})</span>
        </span>
        <input
          name="apiSecret"
          type="password"
          autoComplete="off"
          className={`${field} font-mono`}
        />
        <span className="text-xs text-[var(--muted)] leading-relaxed">{t('secretHint')}</span>
      </label>
      {error ? (
        <p
          role="alert"
          data-testid="shopify-connect-error"
          className="text-sm text-[var(--danger)]"
        >
          {t(`error.${ERROR_KEYS[error]}`)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Spinner size="sm" /> : <Store className="size-4" aria-hidden />}
        {pending ? t('connecting') : t('connect')}
      </button>
    </form>
  );
}
