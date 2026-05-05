import { setTimeout as sleep } from 'node:timers/promises';
import { loadEnv } from './env';

// Load .env BEFORE importing modules that read process.env at import time.
loadEnv();

const { runAuditRunner } = await import('./audit-runner');
const { runKieWatchdog } = await import('./kie-watchdog');

const TICK_MS = 5_000;

async function main(): Promise<void> {
  console.log('[worker] starting');

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] received ${signal}, draining…`);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  while (!stopping) {
    const t0 = Date.now();
    try {
      await Promise.allSettled([runAuditRunner(), runKieWatchdog()]);
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
