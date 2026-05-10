interface SiteFaviconProps {
  domain: string | null | undefined;
  /** Rendered size in px. Default 16. Image is always fetched at 64px so
   *  scaling down stays sharp on hi-DPI screens regardless of `size`. */
  size?: number;
  className?: string;
}

/**
 * Favicon for a merchant's domain, fetched via Google's S2 endpoint.
 *
 * Tradeoffs:
 *  - Free + zero infra. Google returns a generic globe if the merchant
 *    has no favicon, so the UI never falls back to a broken image.
 *  - Third-party dependency: if Google ever blocks us, image just
 *    returns 4xx and the browser shows the alt-text-empty fallback.
 *  - Strips protocol + path so callers can pass `https://shop.foo/cart`
 *    and get the right hostname.
 */
export function SiteFavicon({ domain, size = 16, className = '' }: SiteFaviconProps) {
  if (!domain) return null;
  const cleaned = domain.replace(/^https?:\/\//, '').split('/')[0].trim();
  if (!cleaned) return null;
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleaned)}&sz=64`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      loading="lazy"
    />
  );
}
