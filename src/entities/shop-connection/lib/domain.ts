export const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]?\.myshopify\.com$/;

/** `https://My-Shop.myshopify.com/admin` → `my-shop.myshopify.com`; null when not a Shopify domain. */
export function normalizeShopDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!SHOPIFY_DOMAIN_RE.test(s)) return null;
  return s;
}
