import { useTranslations } from 'next-intl';
import { MockButton, MockField, MockFrame, MockSidebar } from './mock-frame';

/**
 * WordPress admin with the OneShopLab menu entry and its settings page.
 * `paste` highlights the "Site key" field (step 3), `save` the Save button
 * and the status pill that turns green (step 4).
 */
export function WpOslSettings({ variant }: { variant: 'paste' | 'save' }) {
  const t = useTranslations('Integrations.mocks');
  const menu = [
    t('wp.dashboard'),
    t('wp.posts'),
    t('wp.woocommerce'),
    'OneShopLab',
    t('wp.plugins')
  ];
  const connected = variant === 'save';
  return (
    <MockFrame
      id={variant === 'paste' ? 'wp-osl-paste-key' : 'wp-osl-save'}
      url="https://your-shop.com/wp-admin/admin.php?page=oneshoplab"
      label={variant === 'paste' ? t('wp.pasteAria') : t('wp.saveAria')}
    >
      <div className="flex h-full">
        <MockSidebar
          items={menu}
          active="OneShopLab"
          highlight={variant === 'paste' ? 'OneShopLab' : undefined}
          callout={1}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 bg-[#f0f0f1] p-3 text-[#1d2327]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">OneShopLab</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                connected ? 'bg-[#00a32a]/15 text-[#00a32a]' : 'bg-[#dba617]/15 text-[#996800]'
              }`}
            >
              {connected ? t('wp.statusConnected') : t('wp.statusWaiting')}
            </span>
          </div>
          <div className="flex flex-col gap-2 rounded border border-[#c3c4c7] bg-white p-3">
            <MockField
              label={t('wp.siteKey')}
              value={variant === 'paste' ? 'osl_live_…' : 'osl_live_••••••••••••'}
              mono
              highlight={variant === 'paste'}
              callout={2}
            />
            <span className="text-[#50575e]">{t('wp.siteKeyHint')}</span>
            <div>
              <MockButton primary highlight={variant === 'save'} callout={1}>
                {t('wp.save')}
              </MockButton>
            </div>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}
