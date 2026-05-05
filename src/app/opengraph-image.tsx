import { ImageResponse } from 'next/og';

// Route-segment metadata: tells Next 16 to emit this at /opengraph-image and
// reference it in <meta property="og:image"> automatically.
export const runtime = 'nodejs';
export const alt = 'OneShopLab — AI product page optimization';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Open Graph + Twitter card image, generated server-side at build/runtime
 * via Next's @vercel/og wrapper. One image for the whole site — pages can
 * still override via their own `app/<route>/opengraph-image.tsx`.
 *
 * The brand mark on a soft gradient with the wordmark + tagline. Kept
 * intentionally minimal so it reads at thumbnail size on Twitter / LinkedIn
 * / Discord previews.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background:
            'radial-gradient(circle at 30% 20%, #0a84ff 0%, #050b20 60%, #02050d 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
          padding: '80px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '40px' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#0a84ff',
              boxShadow: '0 0 40px #0a84ff'
            }}
          />
          <div style={{ fontSize: '52px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            OneShopLab
          </div>
          <div
            style={{
              fontSize: '18px',
              fontFamily: 'monospace',
              letterSpacing: '0.2em',
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'rgba(10, 132, 255, 0.15)',
              color: '#7ab8ff'
            }}
          >
            BETA
          </div>
        </div>
        <div
          style={{
            fontSize: '64px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            lineHeight: 1.1,
            maxWidth: '900px'
          }}
        >
          AI product page optimization for Shopify, WooCommerce, Wix
        </div>
        <div
          style={{
            fontSize: '28px',
            color: 'rgba(255, 255, 255, 0.7)',
            marginTop: '32px',
            textAlign: 'center',
            maxWidth: '800px'
          }}
        >
          Audit · Score · Rewrite · Redesign
        </div>
      </div>
    ),
    { ...size }
  );
}
