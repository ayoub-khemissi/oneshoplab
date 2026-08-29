'use client';

import { toast } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';

const POLL_INTERVAL_MS = 8_000;

type AuditStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';

interface AuditState {
  id: string;
  status: AuditStatus;
  projectId: string | null;
  projectName: string | null;
}

const TERMINAL: ReadonlySet<AuditStatus> = new Set(['completed', 'failed', 'timed_out']);
const IN_FLIGHT: ReadonlySet<AuditStatus> = new Set(['pending', 'running']);

/**
 * Polls /api/audits/active and surfaces a bottom-right toast whenever an audit
 * the current user has running flips to a terminal state. Mounted globally in
 * the locale layout, so the notification reaches the user no matter which page
 * they're on while the worker processes their audit.
 *
 * The first poll seeds a "last seen status" map without firing toasts — that
 * way audits already finished by the time the page loads stay silent. Only
 * subsequent transitions (in-flight → terminal) trigger a toast.
 */
export function AuditToastWatcher() {
  const t = useTranslations('AuditToast');
  const router = useRouter();
  const lastSeen = useRef<Map<string, AuditStatus>>(new Map());
  const initialized = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll(): Promise<void> {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) {
        scheduleNext();
        return;
      }
      try {
        const res = await fetch('/api/audits/active', { cache: 'no-store' });
        if (res.ok) {
          const list = (await res.json()) as AuditState[];
          processSnapshot(list);
        }
      } catch {
        // Network blips are fine — we'll catch up on the next tick.
      }
      scheduleNext();
    }

    function scheduleNext(): void {
      if (stopped) return;
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    function processSnapshot(list: AuditState[]): void {
      const seenIds = new Set<string>();
      for (const a of list) {
        seenIds.add(a.id);
        const prev = lastSeen.current.get(a.id);
        if (initialized.current && prev && IN_FLIGHT.has(prev) && TERMINAL.has(a.status)) {
          fireToast(a);
        }
        lastSeen.current.set(a.id, a.status);
      }
      // GC entries that fell out of the recent-window response.
      for (const id of lastSeen.current.keys()) {
        if (!seenIds.has(id)) lastSeen.current.delete(id);
      }
      initialized.current = true;
    }

    function fireToast(a: AuditState): void {
      const project = a.projectName ?? '';
      if (a.status === 'completed') {
        toast.success(t('completedTitle'), {
          description: project
            ? t('completedDescription', { project })
            : t('completedDescriptionNoProject'),
          actionProps:
            a.projectId != null
              ? {
                  children: t('viewAction'),
                  onPress: () => router.push(`/dashboard/sites/${a.projectId}`)
                }
              : undefined
        });
      } else {
        toast.danger(t('failedTitle'), {
          description: project
            ? t('failedDescription', { project })
            : t('failedDescriptionNoProject')
        });
      }
    }

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [t, router]);

  return null;
}
