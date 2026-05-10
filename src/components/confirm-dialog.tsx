'use client';

import { AlertDialog, Button } from '@heroui/react';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional supporting copy under the heading. */
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Renders the confirm button in danger styling. Default true since
   *  most call sites are deletions / destructive actions. */
  destructive?: boolean;
  /** Keep the dialog open while the action runs (useful when the
   *  caller awaits a server round-trip). */
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Reusable confirmation modal built on HeroUI's <AlertDialog>. Kept
 * focused on the "Are you sure?" pattern — destructive deletions
 * and big-spend actions like "Regenerate everything". Backdrop is
 * non-dismissable + Escape stays disabled by default (HeroUI's
 * AlertDialog defaults), so the user has to make an explicit choice.
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  isPending = false,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="md">
          <AlertDialog.Dialog>
            <AlertDialog.Header className="flex items-start gap-3">
              <AlertDialog.Icon status={destructive ? 'danger' : 'warning'}>
                <AlertTriangle className="size-5" aria-hidden />
              </AlertDialog.Icon>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <AlertDialog.Heading className="text-base font-semibold">
                  {title}
                </AlertDialog.Heading>
                {description ? (
                  <AlertDialog.Body className="text-sm text-[var(--muted)] leading-relaxed">
                    {description}
                  </AlertDialog.Body>
                ) : null}
              </div>
            </AlertDialog.Header>
            <AlertDialog.Footer className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                isDisabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                {cancelLabel}
              </Button>
              <Button
                variant={destructive ? 'danger' : 'primary'}
                isPending={isPending}
                onClick={async () => {
                  await onConfirm();
                  if (!isPending) onOpenChange(false);
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
