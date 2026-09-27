'use client';

import { Card } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ShopifyConnectionView } from '@/entities/shop-connection/client';
import { ShopifyConnectionCard } from '@/features/shopify-connector/client';

/**
 * The store connection tab inside the Shopify admin. The store is connected
 * by the app itself, so none of the website's install flows (store address,
 * OAuth, access token) apply there. The card shows the link and syncs; a
 * broken link is repaired by the embedded home, which exchanges a fresh
 * token on open.
 */
export function EmbeddedStoreConnection({
  projectId,
  shopify
}: {
  projectId: string;
  shopify: ShopifyConnectionView | null;
}) {
  const t = useTranslations('Integrations.embedded');
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-4">
      {shopify ? (
        <ShopifyConnectionCard
          projectId={projectId}
          initial={shopify}
          appsUrl={`https://${shopify.shopDomain}/admin/settings/apps`}
          canDisconnect={false}
        />
      ) : null}
      {shopify?.status !== 'connected' ? (
        <Card variant="secondary" className="p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t('notConnectedTitle')}</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">{t('notConnectedBody')}</p>
          <NextLink
            href={`/shopify?locale=${locale}`}
            className="self-start inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
          >
            <RefreshCw className="size-4" aria-hidden />
            {t('reconnect')}
          </NextLink>
        </Card>
      ) : null}
    </div>
  );
}
