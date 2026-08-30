import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { persistKieJobFailure, persistKieJobSuccess } from '@/entities/generation-job';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { transitionJob } from '@/entities/generation-job';

interface CallbackBody {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    state?: string;
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
    costTime?: number;
  };
}

/**
 * kie.ai webhook receiver. Idempotent — kie may deliver the same callback
 * multiple times, and we may also poll the same task in parallel via the
 * watchdog. Once a job is in a terminal state, subsequent callbacks are
 * acknowledged and dropped.
 *
 * On success of an image job, the persistKieJobSuccess helper downloads
 * the temp result URLs to Cloudflare R2 (when configured) so the dashboard
 * can display them long after kie's URLs expire.
 */
export async function POST(req: Request) {
  // Webhook signature: kie doesn't sign callbacks, so we put a shared
  // secret in the `?token=` query param when handing them the URL via
  // buildKieCallbackUrl(). Anyone forging a body without the token gets
  // rejected. When KIE_CALLBACK_SECRET isn't configured (dev), we
  // accept everything — easier to debug locally without proxies.
  const expected = process.env.KIE_CALLBACK_SECRET;
  if (expected) {
    const url = new URL(req.url);
    const provided = url.searchParams.get('token');
    if (provided !== expected) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  let payload: CallbackBody;
  try {
    payload = (await req.json()) as CallbackBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const taskId = payload.data?.taskId;
  if (!taskId) {
    return NextResponse.json({ error: 'no_task_id' }, { status: 400 });
  }

  const job = await db.query.jobs.findFirst({ where: eq(jobs.kieTaskId, taskId) });
  if (!job) {
    return NextResponse.json({ ok: true, dropped: 'unknown_task' });
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'timed_out') {
    return NextResponse.json({ ok: true, dropped: 'already_terminal' });
  }

  const state = payload.data?.state;

  if (state === 'success') {
    await persistKieJobSuccess(job.id, job.kind, payload.data?.resultJson, {
      costTimeSeconds: payload.data?.costTime ?? null
    });
    return NextResponse.json({ ok: true, status: 'completed' });
  }

  if (state === 'fail') {
    await persistKieJobFailure(
      job.id,
      job.kind,
      payload.data?.failMsg ?? null,
      payload.data?.failCode ?? null
    );
    return NextResponse.json({ ok: true, status: 'failed' });
  }

  // Intermediate states (waiting / queuing / generating) — promote pending → running.
  if (job.status === 'pending') {
    const r = await transitionJob(
      db,
      job.id,
      'running',
      { startedAt: new Date() },
      { tolerate: true }
    );
    if (r === 'refused') {
      console.warn(`[kie-callback] job ${job.id}: pending → running refused (already moved)`);
    }
  }

  return NextResponse.json({ ok: true, status: 'running' });
}
