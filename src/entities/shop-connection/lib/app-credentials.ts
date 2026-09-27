/**
 * The public Shopify app's credentials (Dev Dashboard → client id / secret).
 * Null when the app is not configured, e.g. in tests and local dev.
 */
export function shopifyAppCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
