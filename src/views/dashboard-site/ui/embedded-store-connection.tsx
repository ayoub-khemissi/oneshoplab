'use client';

import { Card } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ShopifyConnectionView, WixConnectionView } from '@/entities/shop-connection/client';
import { ShopifyConnectionCard } from '@/features/shopify-connector/client';
import { WixConnectionCard } from '@/features/wix-connector/client';
import { EmbeddedHomeLink, type EmbeddedHost } from '@/shared/embedded/client';

/**
 * The store connection tab inside a store admin (Shopify, Wix). The store is
 * connected by the app itself, so none of the website's install flows
 * (store address, OAuth, access token) apply there, and no other platform is
 * mentioned. The card shows the link and syncs; a broken link is repaired
 * by the embedded home, which reconnects the store on open.
 */
export function EmbeddedStoreConnection({
  host,
  projectId,
  shopify,
  wix
}: {
  host: EmbeddedHost;
  projectId: string;
  shopify: ShopifyConnectionView | null;
  wix: WixConnectionView | null;
}) {
  const t = useTranslations('Integrations.embedded');
  const locale = useLocale();
  const connected = host === 'wix' ? wix?.status === 'connected' : shopify?.status === 'connected';
  return (
    <div className="flex flex-col gap-4">
      {host === 'shopify' && shopify ? (
        <ShopifyConnectionCard
          projectId={projectId}
          initial={shopify}
          appsUrl={`https://${shopify.shopDomain}/admin/settings/apps`}
          canDisconnect={false}
        />
      ) : null}
      {host === 'wix' && wix ? (
        <WixConnectionCard projectId={projectId} initial={wix} canDisconnect={false} />
      ) : null}
      {!connected ? (
        <Card variant="secondary" className="p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t('notConnectedTitle')}</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {host === 'wix' ? t('notConnectedBodyWix') : t('notConnectedBody')}
          </p>
          <EmbeddedHomeLink
            host={host}
            locale={locale}
            className="self-start inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
          >
            <RefreshCw className="size-4" aria-hidden />
            {t('reconnect')}
          </EmbeddedHomeLink>
        </Card>
      ) : null}
    </div>
  );
}
