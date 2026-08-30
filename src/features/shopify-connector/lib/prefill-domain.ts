import { normalizeShopDomain } from '@/entities/shop-connection/client';

/** `<handle>.myshopify.com` from the project's domain/URL; empty when the store uses a custom domain. */
export function prefillShopDomain(domain: string | null | undefined): string {
  return normalizeShopDomain(domain ?? '') ?? '';
}
