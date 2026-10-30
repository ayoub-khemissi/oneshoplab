import { useTranslations } from 'next-intl';
import { Callout, HIGHLIGHT, MockButton, MockFrame, MockSidebar } from './mock-frame';

/**
 * WordPress admin, Plugins › Add New. `upload` (step 1) shows the directory
 * search for OneShopLab with its Install Now button — the plugin is on
 * WordPress.org; `activate` (step 2) the Activate button that follows.
 */
export function WpPluginsUpload({ variant }: { variant: 'upload' | 'activate' }) {
  const t = useTranslations('Integrations.mocks');
  const menu = [
    t('wp.dashboard'),
    t('wp.posts'),
    t('wp.woocommerce'),
    t('wp.plugins'),
    t('wp.settings')
  ];
  return (
    <MockFrame
      id={variant === 'upload' ? 'wp-plugins-upload' : 'wp-plugins-activate'}
      url="https://your-shop.com/wp-admin/plugin-install.php?s=OneShopLab&tab=search"
      label={variant === 'upload' ? t('wp.searchAria') : t('wp.activateAria')}
    >
      <div className="flex h-full">
        <MockSidebar
          items={menu}
          active={t('wp.plugins')}
          highlight={t('wp.plugins')}
          callout={1}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 bg-[#f0f0f1] p-3 text-[#1d2327]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{t('wp.addPlugins')}</span>
            <span
              className={`rounded border border-[#8c8f94] bg-white px-2 py-1 ${variant === 'upload' ? HIGHLIGHT : ''}`}
            >
              <span className="text-[#50575e]">{t('wp.searchLabel')} </span>
              <span className="font-medium">OneShopLab</span>
              {variant === 'upload' ? <Callout n={2} className="ml-1" /> : null}
            </span>
          </div>
          {variant === 'upload' ? (
            <div className="flex items-center gap-3 rounded border border-[#c3c4c7] bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/osl-dark.svg" alt="" width={36} height={36} className="size-9 rounded" />
              <span className="flex-1 font-medium">OneShopLab</span>
              <MockButton highlight callout={3}>
                {t('wp.installNow')}
              </MockButton>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded border border-[#c3c4c7] bg-white p-3">
              <span className="font-medium">{t('wp.installing')}</span>
              <span className="text-[#50575e]">{t('wp.unpacking')}</span>
              <span className="text-[#50575e]">{t('wp.installed')}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                <MockButton primary highlight callout={2}>
                  {t('wp.activate')}
                </MockButton>
                <MockButton>{t('wp.goToPlugins')}</MockButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </MockFrame>
  );
}
