import { useTranslations } from 'next-intl';
import { Callout, HIGHLIGHT, MockButton, MockField, MockFrame, MockSidebar } from './mock-frame';

/**
 * Shopify admin, Settings › Apps and sales channels › Develop apps. `open`
 * highlights the path to the page (step 1), `create` the "Create an app"
 * dialog with the app name filled (step 2).
 */
export function ShopifyDevApps({ variant }: { variant: 'open' | 'create' }) {
  const t = useTranslations('Integrations.mocks');
  const menu = [
    t('shopify.general'),
    t('shopify.appsChannels'),
    t('shopify.payments'),
    t('shopify.checkout')
  ];
  return (
    <MockFrame
      id={variant === 'open' ? 'shopify-dev-apps' : 'shopify-create-app'}
      url="https://admin.shopify.com/store/your-shop/settings/apps/development"
      label={variant === 'open' ? t('shopify.openAria') : t('shopify.createAria')}
    >
      <div className="flex h-full bg-[#f1f2f4] text-[#303030]">
        <MockSidebar
          tone="light"
          items={menu}
          active={t('shopify.appsChannels')}
          highlight={variant === 'open' ? t('shopify.appsChannels') : undefined}
          callout={1}
        />
        <div className="relative flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('shopify.appsChannels')}</span>
            <MockButton highlight={variant === 'open'} callout={2}>
              {t('shopify.developApps')}
            </MockButton>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-[#e3e3e3] bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{t('shopify.appDevelopment')}</span>
              <MockButton primary highlight={variant === 'create'} callout={1}>
                {t('shopify.createApp')}
              </MockButton>
            </div>
            <span className="text-[#616161]">{t('shopify.noApps')}</span>
          </div>
          {variant === 'create' ? (
            <div className="absolute inset-x-6 top-10 flex flex-col gap-2 rounded-lg border border-[#e3e3e3] bg-white p-3 shadow-lg">
              <span className="font-medium">{t('shopify.createApp')}</span>
              <MockField label={t('shopify.appName')} value="OneShopLab" highlight callout={2} />
              <div className={`flex justify-end gap-2`}>
                <MockButton>{t('shopify.cancel')}</MockButton>
                <span
                  className={`inline-flex items-center gap-1 rounded bg-[#303030] px-2 py-1 font-medium text-white ${HIGHLIGHT}`}
                >
                  {t('shopify.createApp')}
                  <Callout n={3} />
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </MockFrame>
  );
}
