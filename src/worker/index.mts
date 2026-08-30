import { setTimeout as sleep } from 'node:timers/promises';
import { loadEnv } from './env';

// Load .env BEFORE importing modules that read process.env at import time.
loadEnv();

const { runAuditRunner } = await import('./audit-runner');
const { runAuditWatchdog } = await import('./audit-watchdog');
const { runKieWatchdog } = await import('./kie-watchdog');
const { runR2Cleanup } = await import('./r2-cleanup');
const { processNextBulkProduct, runBulkWatchdog } = await import('@/features/bulk-generate');
const { runIntegrationSweeps: runApiKeySweeps } = await import('@/entities/api-key');
const { runIntegrationSweeps: runChangeSweeps } = await import('@/entities/product-change');

import { writeWorkerHeartbeat } from '@/shared/health';

const TICK_MS = 5_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function main(): Promise<void> {
  console.log('[worker] starting');

  let stopping = false;
  let lastCleanupAt = 0;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] received ${signal}, draining…`);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  while (!stopping) {
    const t0 = Date.now();
    writeWorkerHeartbeat();
    try {
      const tasks: Array<Promise<unknown>> = [
        runAuditRunner(),
        runKieWatchdog(),
        runAuditWatchdog().catch((e) => console.error('[worker] audit-watchdog failed', e)),
        // Bulk catalog generation for Scale plans — one product per
        // tick to bound tick latency. The function returns quickly when
        // no bulk job is in flight.
        processNextBulkProduct().catch((e) => console.error('[worker] bulk-generator failed', e)),
        runBulkWatchdog().catch((e) => console.error('[worker] bulk-watchdog failed', e))
      ];
      // Hourly: drop R2 objects + DB rows for image jobs older than 30
      // days. Ride on the same loop so we don't spawn a separate process.
      if (t0 - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
        lastCleanupAt = t0;
        tasks.push(runR2Cleanup().catch((e) => console.error('[worker] r2-cleanup failed', e)));
        // Integration API housekeeping: key expiry/grace, stale changes,
        // idempotency cache, abandoned catalog sync sessions.
        tasks.push(
          runApiKeySweeps().catch((e) => console.error('[worker] api-key sweep failed', e))
        );
        tasks.push(
          runChangeSweeps().catch((e) => console.error('[worker] product-change sweep failed', e))
        );
      }
      await Promise.allSettled(tasks);
    } catch (e) {
      console.error('[worker] unhandled tick error', e);
    }
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, TICK_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }

  console.log('[worker] stopped cleanly');
}

main().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
