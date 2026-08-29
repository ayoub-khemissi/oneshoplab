import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workerHeartbeatAgeMs } from '@/lib/health/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Worker ticks every 5 s; anything past this is a stuck or dead worker. */
const WORKER_STALE_MS = 90_000;

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

  let build = 'unknown';
  try {
    build = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    /* dev server has no BUILD_ID */
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { ok, checks, build, at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
  );
}
