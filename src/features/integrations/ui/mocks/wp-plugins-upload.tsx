import { useTranslations } from 'next-intl';
import { Callout, HIGHLIGHT, MockButton, MockFrame, MockSidebar } from './mock-frame';

/**
 * WordPress admin, Plugins › Add New › Upload Plugin. `upload` highlights the
 * upload form (step 1), `activate` the "Activate Plugin" button that follows
 * the install (step 2).
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
      url="https://your-shop.com/wp-admin/plugin-install.php?tab=upload"
      label={variant === 'upload' ? t('wp.uploadAria') : t('wp.activateAria')}
    >
      <div className="flex h-full">
        <MockSidebar
          items={menu}
          active={t('wp.plugins')}
          highlight={t('wp.plugins')}
          callout={1}
        />
        <div className="flex flex-1 flex-col gap-2 bg-[#f0f0f1] p-3 text-[#1d2327]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('wp.addPlugins')}</span>
            <MockButton highlight={variant === 'upload'} callout={2}>
              {t('wp.uploadPlugin')}
            </MockButton>
          </div>
          {variant === 'upload' ? (
            <div className="flex flex-col items-center gap-2 rounded border border-dashed border-[#8c8f94] bg-white p-3">
              <span className="text-[#50575e]">{t('wp.uploadHint')}</span>
              <div className="flex items-center gap-2">
                <span className={`rounded border border-[#8c8f94] px-2 py-1 ${HIGHLIGHT}`}>
                  {t('wp.chooseFile')}
                  <Callout n={3} className="ml-1" />
                </span>
                <span className="font-mono text-[#50575e]">oneshoplab.zip</span>
                <MockButton primary>{t('wp.installNow')}</MockButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded border border-[#c3c4c7] bg-white p-3">
              <span className="font-medium">{t('wp.installing')}</span>
              <span className="text-[#50575e]">{t('wp.unpacking')}</span>
              <span className="text-[#50575e]">{t('wp.installed')}</span>
              <div className="mt-1 flex gap-2">
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
