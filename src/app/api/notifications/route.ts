import { NextResponse } from 'next/server';
import { auth } from '@/entities/user';
import { listForBell } from '@/entities/notification';

/**
 * GET /api/notifications
 *   → { rows: NotificationRow[], unreadCount: number }
 *
 * Powers the header-bell dropdown. The client polls this every ~20s
 * while the tab is focused so the badge stays roughly fresh without
 * pushing infra (SSE / websockets) we don't have yet.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await listForBell(session.user.id);
  return NextResponse.json(result, {
    headers: {
      // Disable any caching layer: the bell is per-user real-time
      // signal — a 30s CDN cache would surface stale unread counts.
      'cache-control': 'no-store'
    }
  });
}
