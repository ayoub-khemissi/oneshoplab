/**
 * Env: WIX_APP_ID / WIX_APP_SECRET (OAuth client credentials),
 * WIX_APP_PUBLIC_KEY (webhook JWT, PEM — `\n` escapes accepted),
 * WIX_SHARE_URL_ID (the GUID at the end of the app's share install link —
 * required by Wix's external install flow while the app is not listed on
 * the App Market; optional once it is).
 */
export const WIX_STATE_COOKIE = 'osl_wix_oauth';

export interface WixAppConfig {
  appId: string;
  appSecret: string;
  /** Null until the key is pasted: webhooks are refused (401), pulls still run. */
  publicKey: string | null;
  /** Null for a listed app; unlisted apps cannot install without it. */
  shareUrlId: string | null;
}

export function wixAppConfig(): WixAppConfig | null {
  const appId = process.env.WIX_APP_ID?.trim();
  const appSecret = process.env.WIX_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const publicKey = process.env.WIX_APP_PUBLIC_KEY?.trim().replace(/\\n/g, '\n') || null;
  const shareUrlId = process.env.WIX_SHARE_URL_ID?.trim() || null;
  return { appId, appSecret, publicKey, shareUrlId };
}

export function isWixAppConfigured(): boolean {
  return wixAppConfig() !== null;
}
