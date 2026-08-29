import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { markAllRead, markReadByAudit, markReadByJob } from '@/lib/notifications';

/**
 * POST /api/notifications/mark-read
 *
 * Body shapes (exactly one of):
 *   { all: true }                 → flips every unread row for the user
 *   { jobId: "<uuid>" }           → flips unread notifs linked to that job
 *   { auditId: "<uuid>" }         → flips unread notifs linked to that audit
 *
 * Three callers:
 *   - Bell icon click → { all: true }
 *   - Client toast for a chat event → { jobId } (so we don't double-count
 *     events the merchant just acknowledged in the foreground)
 *   - Future audit-page mount → { auditId }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { all?: boolean; jobId?: string; auditId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (body.all === true) {
    const r = await markAllRead(session.user.id);
    return NextResponse.json({ ok: true, updated: r.updated });
  }
  if (typeof body.jobId === 'string' && body.jobId.length > 0) {
    const r = await markReadByJob(session.user.id, body.jobId);
    return NextResponse.json({ ok: true, updated: r.updated });
  }
  if (typeof body.auditId === 'string' && body.auditId.length > 0) {
    const r = await markReadByAudit(session.user.id, body.auditId);
    return NextResponse.json({ ok: true, updated: r.updated });
  }
  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}
