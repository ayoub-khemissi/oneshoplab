/**
 * One-shot reconciliation: for every job in `running` state with a kieTaskId,
 * poll kie.ai directly and persist the result/failure. Useful when the
 * webhook callback URL was unreachable (e.g. dev with localhost) and the
 * results are already sitting on kie's side.
 *
 * Run with:  pnpm reconcile
 */
import { existsSync, readFileSync } from 'node:fs';

// Load .env synchronously, BEFORE importing modules that read process.env at
// module load time (db, kie client).
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  const { and, eq, isNotNull } = await import('drizzle-orm');
  const { getKieClient } = await import('../src/entities/ai-provider');
  const { persistKieJobFailure, persistKieJobSuccess } =
    await import('../src/entities/generation-job');
  const { db } = await import('../src/lib/db/index');
  const { jobs } = await import('../src/lib/db/schema');

  const stuck = await db.query.jobs.findMany({
    where: and(eq(jobs.status, 'running'), isNotNull(jobs.kieTaskId)),
    limit: 200
  });

  console.log(`Found ${stuck.length} running job(s) with a kieTaskId`);
  if (stuck.length === 0) return;

  let kie;
  try {
    kie = getKieClient();
  } catch (e) {
    console.error('kie client unavailable:', (e as Error).message);
    process.exit(1);
  }

  let success = 0;
  let failed = 0;
  let stillRunning = 0;
  let errors = 0;

  for (const job of stuck) {
    if (!job.kieTaskId) continue;
    const label = `${job.id.slice(0, 8)} ${job.kind}`;
    try {
      const info = await kie.getTask(job.kieTaskId);
      if (info.state === 'success') {
        await persistKieJobSuccess(job.id, job.kind, info.resultJson, {
          costTimeSeconds: info.costTime ?? null
        });
        console.log(`  ✓ ${label} → completed (kie costTime ${info.costTime ?? '?'}s)`);
        success++;
      } else if (info.state === 'fail') {
        await persistKieJobFailure(job.id, job.kind, info.failMsg ?? null, info.failCode ?? null);
        console.log(`  ✗ ${label} → failed (${info.failMsg ?? info.failCode ?? 'unknown'})`);
        failed++;
      } else {
        console.log(`  ⏳ ${label} → still ${info.state}`);
        stillRunning++;
      }
    } catch (e) {
      console.error(`  ! ${label} error: ${(e as Error).message}`);
      errors++;
    }
  }

  console.log(
    `\nDone. ${success} completed, ${failed} failed, ${stillRunning} still running, ${errors} errors.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
