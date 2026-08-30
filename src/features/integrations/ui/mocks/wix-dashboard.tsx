import { useTranslations } from 'next-intl';
import { Callout, HIGHLIGHT, MockButton, MockFrame, MockSidebar } from './mock-frame';

/**
 * Wix dashboard. `apps` shows the Apps entry in the site menu (step 1),
 * `install` the "Add OneShopLab to your site" dialog (step 2, opened by the
 * button in OneShopLab), `consent` the permissions the merchant approves (step 3).
 */
export function WixDashboard({ variant }: { variant: 'apps' | 'install' | 'consent' }) {
  const t = useTranslations('Integrations.mocks.wix');
  const menu = [t('home'), t('store'), t('apps'), t('settings')];
  const id =
    variant === 'apps' ? 'wix-apps' : variant === 'install' ? 'wix-install' : 'wix-consent';
  const label =
    variant === 'apps'
      ? t('appsAria')
      : variant === 'install'
        ? t('installAria')
        : t('consentAria');
  return (
    <MockFrame
      id={id}
      url={
        variant === 'apps'
          ? 'https://manage.wix.com/dashboard/your-site/app-market'
          : 'https://www.wix.com/installer/install'
      }
      label={label}
    >
      <div className="flex h-full bg-[#f7f8fa] text-[#20303c]">
        <MockSidebar
          tone="light"
          items={menu}
          active={t('apps')}
          highlight={variant === 'apps' ? t('apps') : undefined}
          callout={1}
        />
        <div className="relative flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('manageApps')}</span>
            {variant === 'apps' ? <MockButton>{t('appMarket')}</MockButton> : null}
          </div>
          {variant === 'apps' ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-[#dfe5eb] bg-white p-3">
              <span className="text-[#5f6d7a]">{t('noApps')}</span>
              <span className="text-[#5f6d7a]">{t('fromOsl')}</span>
            </div>
          ) : (
            <div className="z-10 mx-5 flex flex-col gap-2 rounded-lg border border-[#dfe5eb] bg-white p-3 shadow-lg">
              <span className="font-medium">
                {variant === 'install' ? t('addTitle') : t('consentTitle')}
              </span>
              {variant === 'install' ? (
                <span className="text-[#5f6d7a]">{t('addBody')}</span>
              ) : (
                <ul className="flex flex-col gap-1 text-[#5f6d7a]">
                  <li className="flex items-center gap-1">
                    <i className="size-1.5 rounded-full bg-[#116dff]" aria-hidden />
                    {t('permProducts')}
                  </li>
                  <li className="flex items-center gap-1">
                    <i className="size-1.5 rounded-full bg-[#116dff]" aria-hidden />
                    {t('permSite')}
                  </li>
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <MockButton>{t('cancel')}</MockButton>
                <span
                  className={`inline-flex items-center gap-1 rounded-full bg-[#116dff] px-2 py-1 font-medium text-white ${HIGHLIGHT}`}
                >
                  {variant === 'install' ? t('addToSite') : t('agree')}
                  <Callout n={1} />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </MockFrame>
  );
}
