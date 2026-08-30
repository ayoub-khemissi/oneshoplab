import {
  integrationAlertRecipient,
  sendIntegrationAlert,
  type IntegrationAlertKind,
  type IntegrationAlertParams
} from '@/entities/notification';
import { claimExpiringKeys, expireDueKeys, revokeGraceExpired, type SweptKey } from './keys';

async function alertKeys(
  keys: SweptKey[],
  kind: IntegrationAlertKind,
  params: (k: SweptKey) => IntegrationAlertParams
): Promise<void> {
  for (const k of keys) {
    const to = await integrationAlertRecipient(k.projectId);
    if (!to) continue;
    await sendIntegrationAlert({ ...to, kind, params: { keyName: k.name, ...params(k) } });
  }
}

/** J-7 expiry email + bell, once per key (`expiry_notice` event). */
export async function notifyExpiringKeys(now: Date = new Date()): Promise<number> {
  const keys = await claimExpiringKeys(now);
  await alertKeys(keys, 'integration_key_expiring', (k) => ({
    expiresAt: k.expiresAt ?? undefined,
    days: k.expiresAt ? Math.ceil((k.expiresAt.getTime() - now.getTime()) / 86_400_000) : 0
  }));
  return keys.length;
}

/** Hourly worker sweep (wired in src/worker/index.mts). */
export async function runIntegrationSweeps(now: Date = new Date()): Promise<{
  expired: number;
  graceRevoked: number;
  expiring: number;
}> {
  const expiredKeys = await expireDueKeys(now);
  await alertKeys(expiredKeys, 'integration_key_expired', (k) => ({
    expiresAt: k.expiresAt ?? undefined
  }));
  const revokedKeys = await revokeGraceExpired(now);
  await alertKeys(revokedKeys, 'integration_key_revoked', () => ({}));
  const expiring = await notifyExpiringKeys(now);
  const expired = expiredKeys.length;
  const graceRevoked = revokedKeys.length;
  if (expired || graceRevoked || expiring) {
    console.info(
      `[api-key] sweep: expired=${expired} graceRevoked=${graceRevoked} expiring=${expiring}`
    );
  }
  return { expired, graceRevoked, expiring };
}
