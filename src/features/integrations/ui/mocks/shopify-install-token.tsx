import { useTranslations } from 'next-intl';
import { Callout, HIGHLIGHT, MockButton, MockField, MockFrame } from './mock-frame';

/**
 * Shopify app › API credentials. `install` highlights "Install app" and the
 * one-time "Reveal token once" (step 4); `paste` shows the revealed token
 * being copied into OneShopLab (step 5).
 */
export function ShopifyInstallToken({ variant }: { variant: 'install' | 'paste' }) {
  const t = useTranslations('Integrations.mocks');
  return (
    <MockFrame
      id={variant === 'install' ? 'shopify-install-token' : 'shopify-paste-token'}
      url="https://admin.shopify.com/store/your-shop/settings/apps/development/…/api_credentials"
      label={variant === 'install' ? t('shopify.installAria') : t('shopify.pasteAria')}
    >
      <div className="flex h-full flex-col gap-2 bg-[#f1f2f4] p-3 text-[#303030]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">OneShopLab</span>
          <MockButton primary highlight={variant === 'install'} callout={1}>
            {t('shopify.installApp')}
          </MockButton>
        </div>
        <div className="flex flex-col gap-1.5 rounded-lg border border-[#e3e3e3] bg-white p-3">
          <span className="font-medium">{t('shopify.adminApiToken')}</span>
          {variant === 'install' ? (
            <>
              <span className="text-[#616161]">{t('shopify.tokenOnceHint')}</span>
              <span
                className={`inline-flex w-fit items-center gap-1 rounded border border-[#8a8a8a] px-2 py-1 font-medium ${HIGHLIGHT}`}
              >
                {t('shopify.revealToken')}
                <Callout n={2} />
              </span>
            </>
          ) : (
            <MockField
              label={t('shopify.adminApiToken')}
              value="shpat_••••••••••••••••"
              mono
              highlight
              callout={1}
            />
          )}
        </div>
        {variant === 'paste' ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--background)] p-2 text-[var(--foreground)]">
            <span className="font-medium">OneShopLab</span>
            <span className="text-[var(--muted)]">›</span>
            <MockField label={t('shopify.tokenField')} value="shpat_…" mono highlight callout={2} />
          </div>
        ) : null}
      </div>
    </MockFrame>
  );
}
