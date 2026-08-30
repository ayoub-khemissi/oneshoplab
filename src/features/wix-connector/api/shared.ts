import {
  markTokenInvalid,
  withDecryptedWixSecrets,
  type DecryptedWixSecrets,
  type ShopConnection
} from '@/entities/shop-connection';
import { wixAppConfig } from '../lib/config';
import { alertTokenInvalid } from './alerts';
import { createWixClient, type WixClient } from './client';

export type MakeWixClient = typeof createWixClient;

/** Client for a connected Wix project, or null (no connection / app not configured). */
export async function withWixClient<T>(
  projectId: string,
  makeClient: MakeWixClient,
  fn: (client: WixClient, secrets: DecryptedWixSecrets, connection: ShopConnection) => Promise<T>
): Promise<T | null> {
  const cfg = wixAppConfig();
  if (!cfg) return null;
  return withDecryptedWixSecrets(projectId, (secrets, connection) =>
    fn(
      makeClient({
        appId: cfg.appId,
        appSecret: cfg.appSecret,
        refreshToken: secrets.refreshToken
      }),
      secrets,
      connection
    )
  );
}

export async function flagTokenInvalid(projectId: string, message: string): Promise<void> {
  if (await markTokenInvalid(projectId, message)) await alertTokenInvalid(projectId);
}
