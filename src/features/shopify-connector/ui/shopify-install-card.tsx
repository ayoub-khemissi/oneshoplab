'use client';

import { ExternalLink, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { normalizeShopDomain } from '@/entities/shop-connection/client';
import { prefillShopDomain } from '../lib/prefill-domain';

const field =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';

/** `GET /api/integrations/shopify/install?projectId&shop&locale` — the route 302s to Shopify. */
export function shopifyInstallUrl(projectId: string, shop: string, locale: string): string {
  const qs = new URLSearchParams({ projectId, shop, locale });
  return `/api/integrations/shopify/install?${qs.toString()}`;
}

/**
 * Public-app path (shown first when the app is configured): confirm the
 * `xxx.myshopify.com` address, one click, Shopify asks for consent and sends
 * the merchant back to this tab (`?connected=shopify`). Same-tab navigation
 * on purpose: the state cookie and the session must travel with it.
 */
export function ShopifyInstallCard({
  projectId,
  domain,
  locale
}: {
  projectId: string;
  /** Project domain or URL: prefills the shop address when it is a myshopify host. */
  domain: string | null;
  locale: string;
}) {
  const t = useTranslations('Integrations.shopifyApp');
  const [shop, setShop] = useState(() => prefillShopDomain(domain));
  const [invalid, setInvalid] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = normalizeShopDomain(shop);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    window.location.assign(shopifyInstallUrl(projectId, normalized, locale));
  }

  return (
    <form
      onSubmit={submit}
      data-testid="shopify-install-card"
      className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-5 flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold inline-flex items-center gap-2">
          <Store className="size-5 text-[var(--accent)]" aria-hidden />
          {t('title')}
        </span>
        <p className="text-sm text-[var(--muted)] leading-relaxed">{t('body')}</p>
      </div>
      <label className="flex flex-col gap-1 text-sm max-w-md">
        <span className="font-medium">{t('domainLabel')}</span>
        <input
          name="shop"
          value={shop}
          onChange={(e) => {
            setShop(e.target.value);
            setInvalid(false);
          }}
          placeholder="ma-boutique.myshopify.com"
          autoComplete="off"
          spellCheck={false}
          required
          className={field}
        />
        <span className="text-xs text-[var(--muted)]">{t('domainHint')}</span>
      </label>
      {invalid ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {t('invalidDomain')}
        </p>
      ) : null}
      <button
        type="submit"
        className="self-start inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-semibold hover:opacity-90"
      >
        {t('install')}
        <ExternalLink className="size-4" aria-hidden />
      </button>
      <p className="text-xs text-[var(--muted)] leading-relaxed">{t('afterInstall')}</p>
    </form>
  );
}
