import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Worker liveness for /api/health. The worker stamps this file every tick;
 * web reads its age. Same box, same checkout, so a plain file beats a DB
 * row (works even when the DB is the thing that is down). `data/` is
 * gitignored and already used for local state.
 */
const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? join(process.cwd(), 'data', 'worker.heartbeat');

export function writeWorkerHeartbeat(): void {
  try {
    mkdirSync(dirname(HEARTBEAT_FILE), { recursive: true });
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch (e) {
    console.error('[worker] heartbeat write failed', (e as Error).message);
  }
}

/** Milliseconds since the last worker tick, or null if never seen. */
export function workerHeartbeatAgeMs(): number | null {
  try {
    const ts = Number(readFileSync(HEARTBEAT_FILE, 'utf8'));
    return Number.isFinite(ts) ? Date.now() - ts : null;
  } catch {
    return null;
  }
}
