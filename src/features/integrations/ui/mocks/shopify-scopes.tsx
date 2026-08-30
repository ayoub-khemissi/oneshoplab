import { useTranslations } from 'next-intl';
import { Callout, HIGHLIGHT, MockButton, MockFrame } from './mock-frame';

const SCOPES: { id: string; ticked: boolean }[] = [
  { id: 'read_orders', ticked: false },
  { id: 'read_products', ticked: true },
  { id: 'write_products', ticked: true },
  { id: 'read_themes', ticked: false }
];

/** Shopify app › Configuration › Admin API integration: the scopes checklist (step 3). */
export function ShopifyScopes() {
  const t = useTranslations('Integrations.mocks');
  return (
    <MockFrame
      id="shopify-scopes"
      url="https://admin.shopify.com/store/your-shop/settings/apps/development/…/configuration"
      label={t('shopify.scopesAria')}
    >
      <div className="flex h-full flex-col gap-2 bg-[#f1f2f4] p-3 text-[#303030]">
        <div className="flex items-center gap-3 border-b border-[#e3e3e3] pb-1">
          <span className="text-[#616161]">{t('shopify.overview')}</span>
          <span className="rounded bg-white px-1.5 py-0.5 font-medium">
            {t('shopify.configuration')}
          </span>
          <span className="text-[#616161]">{t('shopify.apiCredentials')}</span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-lg border border-[#e3e3e3] bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{t('shopify.adminApiScopes')}</span>
            <MockButton primary highlight callout={2}>
              {t('shopify.save')}
            </MockButton>
          </div>
          <span className="text-[#616161]">{t('shopify.scopesHint')}</span>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {SCOPES.map((scope) => (
              <li
                key={scope.id}
                className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${scope.ticked ? HIGHLIGHT : ''}`}
              >
                <span
                  aria-hidden
                  className={`inline-flex size-3 items-center justify-center rounded-sm border ${
                    scope.ticked ? 'border-[#303030] bg-[#303030] text-white' : 'border-[#8a8a8a]'
                  }`}
                >
                  {scope.ticked ? '✓' : ''}
                </span>
                <span className="font-mono">{scope.id}</span>
                {scope.ticked ? <Callout n={1} className="ml-auto" /> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MockFrame>
  );
}
