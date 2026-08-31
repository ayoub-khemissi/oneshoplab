'use client';

import { Modal, Spinner } from '@heroui/react';
import { AlertTriangle, Check, ListChecks, Store, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { applyPendingChangesAction, cancelChangeAction, dismissChangeAction } from '../api/actions';
import { groupByProduct, resultParts } from '../lib/pending-summary';
import type { ApplySelectionCounts, PendingChangeItem } from '../model/types';
import { PendingChangeRow } from './pending-change-row';

export interface PendingChangesModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every item belongs to this project — the modal is always site-scoped. */
  projectId: string;
  items: PendingChangeItem[];
}

/**
 * Recap of everything waiting for the merchant's store, opened by a button and
 * never on its own. Rows are grouped by product; conflicts and failures get
 * their own section because neither is fixed by clicking "apply" again without
 * looking. Selection is stored as the *deselected* ids so a refresh that brings
 * new rows keeps "everything selected" true.
 */
export function PendingChangesModal({
  isOpen,
  onOpenChange,
  projectId,
  items
}: PendingChangesModalProps) {
  const t = useTranslations('PendingChanges');
  const router = useRouter();
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  const [withdrawn, setWithdrawn] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<ApplySelectionCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const visible = items.filter((i) => !withdrawn.has(i.id));
  const pending = visible.filter((i) => i.status === 'pending');
  const conflicts = visible.filter((i) => i.status === 'conflict');
  const failures = visible.filter((i) => i.status === 'failed');
  // A conflict is never re-sent in bulk: the store moved, the merchant has to
  // look first (same rule as the per-generation button).
  const selectable = visible.filter(
    (i) => i.status === 'pending' || (i.status === 'failed' && i.retryable)
  );
  const isSelectable = (id: string) => selectable.some((i) => i.id === id);
  const selectedIds = selectable.filter((i) => !deselected.has(i.id)).map((i) => i.id);

  function toggle(id: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply(ids: string[]) {
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await applyPendingChangesAction(projectId, ids);
      if (res.ok) {
        setResult({ queued: res.queued, conflict: res.conflict, failed: res.failed });
        setDeselected(new Set());
      } else {
        setError(t('errorGeneric'));
      }
      router.refresh();
    });
  }

  function withdraw(id: string) {
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('changeId', id);
    setError(null);
    startTransition(async () => {
      const res = await cancelChangeAction(fd);
      if (res.ok) setWithdrawn((prev) => new Set(prev).add(id));
      else setError(t('errorGeneric'));
      router.refresh();
    });
  }

  function dismiss(id: string) {
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('changeId', id);
    setError(null);
    startTransition(async () => {
      const res = await dismissChangeAction(fd);
      if (res.ok) setWithdrawn((prev) => new Set(prev).add(id));
      else setError(t('errorGeneric'));
      router.refresh();
    });
  }

  const parts = result
    ? resultParts(result, {
        queued: (count) => t('resultQueued', { count }),
        conflict: (count) => t('resultConflict', { count }),
        failed: (count) => t('resultFailed', { count })
      })
    : [];

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header className="flex flex-col gap-1">
              <Modal.Heading className="inline-flex items-center gap-2 text-base font-semibold">
                <ListChecks className="size-4" aria-hidden /> {t('title')}
              </Modal.Heading>
              <p className="text-sm leading-relaxed text-[var(--muted)]">{t('intro')}</p>
            </Modal.Header>

            <Modal.Body
              data-testid="pending-changes-modal"
              className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto"
            >
              {visible.length === 0 ? (
                <p data-testid="pending-empty" className="text-sm italic text-[var(--muted)]">
                  {result ? t('emptyAfterApply') : t('empty')}
                </p>
              ) : null}

              {pending.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                      {t('waitingTitle')}
                    </span>
                    <span
                      data-testid="pending-selection-count"
                      className="text-xs text-[var(--muted)]"
                    >
                      {t('selectionCount', {
                        selected: selectedIds.length,
                        total: selectable.length
                      })}
                    </span>
                  </div>
                  {groupByProduct(pending).map((group) => (
                    <div key={group.productId} className="flex flex-col gap-1.5">
                      <h4 className="truncate text-sm font-medium">{group.productTitle}</h4>
                      <ul className="flex flex-col gap-2">
                        {group.items.map((item) => (
                          <PendingChangeRow
                            key={item.id}
                            item={item}
                            selectable
                            selected={!deselected.has(item.id)}
                            busy={busy}
                            onToggle={() => toggle(item.id)}
                            onWithdraw={() => withdraw(item.id)}
                            onRetry={() => apply([item.id])}
                            onDismiss={() => dismiss(item.id)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ) : null}

              {conflicts.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--warning,var(--danger))]">
                    <AlertTriangle className="size-3.5" aria-hidden /> {t('conflictsTitle')}
                  </span>
                  <p className="text-xs leading-relaxed text-[var(--muted)]">
                    {t('conflictsHint')}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {conflicts.map((item) => (
                      <PendingChangeRow
                        key={item.id}
                        item={item}
                        selectable={false}
                        selected={false}
                        busy={busy}
                        onToggle={() => toggle(item.id)}
                        onWithdraw={() => withdraw(item.id)}
                        onRetry={() => apply([item.id])}
                        onDismiss={() => dismiss(item.id)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {failures.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--danger)]">
                    <XCircle className="size-3.5" aria-hidden /> {t('failuresTitle')}
                  </span>
                  <p className="text-xs leading-relaxed text-[var(--muted)]">{t('failuresHint')}</p>
                  <ul className="flex flex-col gap-2">
                    {failures.map((item) => (
                      <PendingChangeRow
                        key={item.id}
                        item={item}
                        selectable={isSelectable(item.id)}
                        selected={!deselected.has(item.id)}
                        busy={busy}
                        onToggle={() => toggle(item.id)}
                        onWithdraw={() => withdraw(item.id)}
                        onRetry={() => apply([item.id])}
                        onDismiss={() => dismiss(item.id)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
            </Modal.Body>

            <Modal.Footer className="flex flex-col gap-3 pt-2">
              {parts.length > 0 ? (
                <p
                  data-testid="pending-result"
                  role="status"
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--success)]"
                >
                  <Check className="size-4" aria-hidden /> {parts.join(' · ')}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-md px-3 py-2 text-sm hover:bg-[var(--default)]"
                >
                  {t('close')}
                </button>
                <button
                  type="button"
                  onClick={() => apply(selectable.map((i) => i.id))}
                  disabled={busy || selectable.length === 0}
                  data-testid="pending-apply-all"
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:border-[var(--accent)] disabled:opacity-50"
                >
                  {t('applyAll')}
                </button>
                <button
                  type="button"
                  onClick={() => apply(selectedIds)}
                  disabled={busy || selectedIds.length === 0}
                  data-testid="pending-apply-selection"
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Spinner size="sm" /> : <Store className="size-4" aria-hidden />}
                  {t('applySelection', { count: selectedIds.length })}
                </button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
