import type { ShopifyTokenGrant } from '@/entities/shop-connection';

/** Body of Shopify's `/admin/oauth/access_token`, whatever the grant. */
export interface ShopifyTokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export function parseShopifyTokenResponse(
  body: ShopifyTokenResponse,
  now: number = Date.now()
): { grant: ShopifyTokenGrant; scopes: string[] } | null {
  if (!body.access_token) return null;
  const at = (seconds: number | undefined) =>
    typeof seconds === 'number' && seconds > 0 ? new Date(now + seconds * 1000) : null;
  return {
    grant: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresAt: at(body.expires_in),
      refreshExpiresAt: at(body.refresh_token_expires_in)
    },
    scopes: (body.scope ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}
