/** Env: WIX_APP_ID / WIX_APP_SECRET (OAuth) / WIX_APP_PUBLIC_KEY (webhook JWT, PEM — `\n` escapes accepted). */
export const WIX_STATE_COOKIE = 'osl_wix_oauth';

export interface WixAppConfig {
  appId: string;
  appSecret: string;
  /** Null until the key is pasted: webhooks are refused (401), pulls still run. */
  publicKey: string | null;
}

export function wixAppConfig(): WixAppConfig | null {
  const appId = process.env.WIX_APP_ID?.trim();
  const appSecret = process.env.WIX_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const publicKey = process.env.WIX_APP_PUBLIC_KEY?.trim().replace(/\\n/g, '\n') || null;
  return { appId, appSecret, publicKey };
}

export function isWixAppConfigured(): boolean {
  return wixAppConfig() !== null;
}
