'use client';

import { PlatformLogo } from '@/shared/ui';
import { Card } from '@heroui/react';
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { ShopifyConnectionView, WixConnectionView } from '@/entities/shop-connection/client';
import { setPlatformAction } from '@/features/integrations/actions';
import {
  ConnectionStatusCard,
  isComingSoon,
  KeyManagement,
  KeyReveal,
  PlatformGuide,
  PlatformPicker,
  platformName,
  ReturnNotice,
  shopifyAdminBase,
  SiteKeyStep,
  type ConnectionStatus,
  type IntegrationInterestMap,
  type IntegrationPlatform,
  type IntegrationReturn,
  type KeyActionResult,
  type PlatformRequirementsMap,
  type SiteKeySummary
} from '@/features/integrations/client';
import {
  ShopifyConnectForm,
  ShopifyConnectionCard,
  ShopifyInstallCard
} from '@/features/shopify-connector/client';
import { WebhooksSection } from '@/features/webhook-delivery/client';
import { WixConnectionCard, WixInstallButton } from '@/features/wix-connector/client';

/**
 * Spec §9: choose platform → numbered guide → site key (created here, shown
 * once) → live connection check → key management. State stays client-side so
 * the freshly created plaintext survives until the merchant confirms it.
 * Shopify has no site key: with the public app configured, step 2 is the
 * one-click install (token form kept behind "other method") and step 3 the
 * connection card; without it, step 3 is the token form and step 4 the card.
 * Wix is install-only (our Wix app), mirrored on the Shopify app path. The
 * widget composes features/integrations, shopify-connector, wix-connector
 * and webhook-delivery — features never import each other.
 */
export function IntegrationsWizard({
  projectId,
  domain,
  pluginVersion,
  requirements,
  detectedPlatform,
  initialKeys,
  initialStatus,
  interest,
  shopifyAppConfigured,
  wixAppConfigured,
  returnNotice
}: {
  projectId: string;
  /** Project domain or URL used to build the "Open" links of the guide. */
  domain: string | null;
  /** Version of the served WordPress plugin zip (null when unknown). */
  pluginVersion: string | null;
  /** Minimum versions shown in each tutorial header (`buildPlatformRequirements`). */
  requirements: PlatformRequirementsMap;
  detectedPlatform: IntegrationPlatform | null;
  initialKeys: SiteKeySummary[];
  initialStatus: ConnectionStatus;
  interest: IntegrationInterestMap;
  /** `isShopifyAppConfigured()` / `isWixAppConfigured()`, computed by the view (env is server-only). */
  shopifyAppConfigured: boolean;
  wixAppConfigured: boolean;
  returnNotice: IntegrationReturn;
}) {
  const t = useTranslations('Integrations');
  const locale = useLocale();
  const [platform, setPlatform] = useState<IntegrationPlatform | null>(detectedPlatform);
  // The audit already told us the platform: route straight to its guide and
  // keep the picker one click away ("Changer"). A real connection later
  // overrides the stored source anyway (server side).
  const [showPicker, setShowPicker] = useState(detectedPlatform === null);
  const [keys, setKeys] = useState(initialKeys);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [rotatedPlaintext, setRotatedPlaintext] = useState<string | null>(null);
  const [shopify, setShopify] = useState<ShopifyConnectionView | null>(initialStatus.shopify);
  const [wix, setWix] = useState<WixConnectionView | null>(initialStatus.wix);

  const usable = keys.filter((k) => k.state === 'active' || k.state === 'grace');
  const activeKey = usable.find((k) => k.state === 'active') ?? usable[0] ?? null;
  const isShopify = platform === 'shopify';
  const isWix = platform === 'wix';
  const comingSoon = platform !== null && isComingSoon(platform, { wixAppConfigured });
  const keyStepAvailable = platform !== null && !isShopify && !isWix && !comingSoon;
  const shopifyLive = shopify !== null && shopify.status !== 'revoked';
  const wixLive = wix !== null && wix.status !== 'revoked';
  const shopifyApp = isShopify && shopifyAppConfigured;
  const wixApp = isWix && wixAppConfigured;

  function choosePlatform(next: IntegrationPlatform) {
    setPlatform(next);
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('platform', next);
    void setPlatformAction(fd);
  }

  function onCreated(res: Extract<KeyActionResult, { ok: true }>) {
    setKeys((prev) => [...prev, res.key]);
    setRevealed(res.plaintext);
  }

  function onRotated(res: Extract<KeyActionResult, { ok: true }>, oldKeyId: string) {
    setKeys((prev) => [
      ...prev.map((k) => (k.id === oldKeyId ? { ...k, state: 'grace' as const } : k)),
      res.key
    ]);
    setRotatedPlaintext(res.plaintext);
  }

  const guide = (
    <PlatformGuide
      projectId={projectId}
      platform={platform}
      domain={domain}
      pluginVersion={pluginVersion}
      requirements={requirements}
      siteKeyPlaintext={revealed}
      interest={interest}
      comingSoon={comingSoon}
    />
  );

  const shopifyTokenForm = shopifyLive ? (
    <p className="text-sm text-[var(--muted)]">
      {t('shopify.alreadyConnected', { shop: shopify.shopName ?? shopify.shopDomain })}
    </p>
  ) : (
    <ShopifyConnectForm projectId={projectId} domain={domain} onConnected={setShopify} />
  );

  const shopifyCard = shopify ? (
    <ShopifyConnectionCard
      key={shopify.status}
      projectId={projectId}
      initial={shopify}
      appsUrl={
        shopify.authMode === 'oauth'
          ? `${shopifyAdminBase(shopify.shopDomain)}/settings/apps`
          : `${shopifyAdminBase(domain)}/settings/apps/development`
      }
      onDisconnected={() => setShopify(null)}
    />
  ) : null;

  const step2Title = shopifyApp
    ? t('shopifyApp.step2Title')
    : isShopify
      ? t('shopify.step2Title')
      : wixApp
        ? t('wix.step2Title')
        : t('step2Title');

  return (
    <div className="flex flex-col gap-4">
      <Card variant="secondary" className="p-5 flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t('wizardTitle')}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed max-w-2xl">{t('wizardIntro')}</p>
      </Card>

      <ReturnNotice notice={returnNotice} platform={platform} />

      <Step n={1} title={t('step1Title')} hint={showPicker ? t('step1Hint') : undefined}>
        {showPicker ? (
          <PlatformPicker value={platform} detected={detectedPlatform} onChange={choosePlatform} />
        ) : (
          <div
            className="flex flex-wrap items-center gap-3 text-sm"
            data-testid="platform-detected"
          >
            {platform ? <PlatformLogo platform={platform} className="size-6 shrink-0" /> : null}
            <span>{t('platformLocked', { platform: platform ? platformName(platform) : '' })}</span>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              {t('changePlatform')}
            </button>
          </div>
        )}
      </Step>

      <Step n={2} title={step2Title}>
        {shopifyApp ? (
          <div className="flex flex-col gap-4">
            {shopifyLive ? (
              <p className="text-sm text-[var(--muted)]">
                {t('shopify.alreadyConnected', { shop: shopify.shopName ?? shopify.shopDomain })}
              </p>
            ) : (
              <ShopifyInstallCard projectId={projectId} domain={domain} locale={locale} />
            )}
            <details data-testid="shopify-token-method" className="group">
              <summary className="cursor-pointer select-none text-sm font-medium text-[var(--accent)] inline-flex items-center gap-1">
                <ChevronDown
                  className="size-4 transition-transform group-open:rotate-180"
                  aria-hidden
                />
                {t('shopifyApp.otherMethod')}
              </summary>
              <div className="mt-4 flex flex-col gap-5">
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  {t('shopifyApp.otherMethodBody')}
                </p>
                {guide}
                {shopifyTokenForm}
              </div>
            </details>
          </div>
        ) : wixApp ? (
          <div className="flex flex-col gap-5">
            {guide}
            {wixLive ? (
              <p className="text-sm text-[var(--muted)]">
                {t('wix.alreadyConnected', { shop: wix.shopName ?? wix.shopDomain })}
              </p>
            ) : (
              <WixInstallButton projectId={projectId} locale={locale} />
            )}
          </div>
        ) : (
          guide
        )}
      </Step>

      {shopifyApp || wixApp ? (
        <Step n={3} title={t('step4Title')}>
          {shopifyApp && shopifyCard ? (
            shopifyCard
          ) : wixApp && wix ? (
            <WixConnectionCard
              key={wix.status}
              projectId={projectId}
              initial={wix}
              onDisconnected={() => setWix(null)}
            />
          ) : (
            <p className="text-sm text-[var(--muted)] italic" data-testid="install-waiting">
              {shopifyApp ? t('shopifyApp.waiting') : t('wix.waiting')}
            </p>
          )}
        </Step>
      ) : (
        <Step n={3} title={isShopify ? t('shopify.step3Title') : t('step3Title')}>
          {isShopify ? (
            shopifyTokenForm
          ) : keyStepAvailable ? (
            <SiteKeyStep
              projectId={projectId}
              activeKey={activeKey}
              revealed={revealed}
              onCreated={onCreated}
              onSaved={() => setRevealed(null)}
            />
          ) : (
            <p className="text-sm text-[var(--muted)] italic">
              {platform
                ? t('step3NotAvailable', { platform: platformName(platform) })
                : t('chooseFirst')}
            </p>
          )}
        </Step>
      )}

      {isShopify && !shopifyAppConfigured && shopifyCard ? (
        <Step n={4} title={t('step4Title')}>
          {shopifyCard}
        </Step>
      ) : null}

      {keyStepAvailable && activeKey ? (
        <Step n={4} title={t('step4Title')}>
          <ConnectionStatusCard projectId={projectId} initial={initialStatus} />
        </Step>
      ) : null}

      {keys.length > 0 ? (
        <Card variant="secondary" className="p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t('keysTitle')}</h3>
          {rotatedPlaintext ? (
            <KeyReveal plaintext={rotatedPlaintext} onSaved={() => setRotatedPlaintext(null)} />
          ) : null}
          <KeyManagement
            projectId={projectId}
            keys={keys}
            onRotated={onRotated}
            onRevoked={(id) =>
              setKeys((prev) =>
                prev.map((k) => (k.id === id ? { ...k, state: 'revoked' as const } : k))
              )
            }
          />
        </Card>
      ) : null}

      <WebhooksSection projectId={projectId} />
    </div>
  );
}

function Step({
  n,
  title,
  hint,
  children
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="size-7 rounded-full border border-[var(--accent)] text-[var(--accent)] text-sm font-semibold inline-flex items-center justify-center shrink-0">
          {n}
        </span>
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}
