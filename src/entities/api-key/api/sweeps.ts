import { expireDueKeys, revokeGraceExpired } from './keys';

/** Hourly worker sweep (wired in src/worker/index.mts). */
export async function runIntegrationSweeps(now: Date = new Date()): Promise<{
  expired: number;
  graceRevoked: number;
}> {
  const expired = await expireDueKeys(now);
  const graceRevoked = await revokeGraceExpired(now);
  if (expired || graceRevoked) {
    console.info(`[api-key] sweep: expired=${expired} graceRevoked=${graceRevoked}`);
  }
  return { expired, graceRevoked };
}
