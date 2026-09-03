import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/shared/db';
import { workerHeartbeatAgeMs } from '@/shared/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Worker ticks every 5 s; anything past this is a stuck or dead worker. */
const WORKER_STALE_MS = 90_000;

/** Read at module load, so it names the build this process booted on and not
 *  whatever a later deploy wrote to disk. See the mismatch check in GET. */
const build = ((): string => {
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    return 'unknown'; // dev server has no BUILD_ID
  }
})();

interface Check {
  ok: boolean;
  detail?: string;
}

/**
 * GET /api/health — polled by scripts/ops/healthcheck.sh (cron, Discord
 * alert) and usable by any external uptime monitor. 200 when everything
 * a customer needs is up, 503 otherwise. Deliberately terse: no versions
 * of dependencies, no hostnames, nothing an attacker can use.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, Check> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: (e as Error).message.slice(0, 120) };
  }

  const age = workerHeartbeatAgeMs();
  checks.worker =
    age === null
      ? { ok: false, detail: 'no heartbeat' }
      : { ok: age < WORKER_STALE_MS, detail: `${Math.round(age / 1000)}s ago` };

  // `build` is read once, when this module is first loaded — i.e. the build the
  // running PROCESS started on. `builtOnDisk` is re-read per request. They
  // differ when a deploy built but never restarted PM2, which used to look
  // exactly like a healthy deploy because both values came off disk.
  let builtOnDisk = build;
  try {
    builtOnDisk = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    /* dev server has no BUILD_ID */
  }
  if (builtOnDisk !== build) {
    checks.build = { ok: false, detail: `process on ${build}, disk has ${builtOnDisk}` };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { ok, checks, build, builtOnDisk, at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
  );
}
