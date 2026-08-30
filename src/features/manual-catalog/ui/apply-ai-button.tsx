'use client';

import { Button } from '@heroui/react';
import { Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { applyAiToManualProductAction } from '../api/actions';

interface Props {
  projectId: string;
  productId: string;
  /** Which fields currently have at least one completed AI generation.
   *  Drives the per-field bullet list inside the confirm modal so the
   *  merchant sees exactly what's about to be replaced. */
  available: {
    title: boolean;
    description: boolean;
    tags: boolean;
    images: boolean;
  };
}

/**
 * Manual-only CTA that swaps the user-entered product content for the
 * latest AI suggestions. Rendered next to "Generate all" so the
 * generate → preview → adopt flow reads top-to-bottom on the AI
 * panel. Hidden entirely when no AI work has landed yet — there's
 * nothing to apply, the button would just be noise.
 *
 * On mobile the button sits in the same flex-wrap container as the
 * other AI panel controls, so it falls onto its own line on narrow
 * screens. The confirm modal uses the existing HeroUI AlertDialog
 * which already adapts to small viewports.
 */
export function ApplyAiButton({ projectId, productId, available }: Props) {
  const t = useTranslations('Product');
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const anyAvailable =
    available.title || available.description || available.tags || available.images;
  if (!anyAvailable) return null;

  function handleConfirm(): void {
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('productId', productId);
    startTransition(() => {
      void applyAiToManualProductAction(fd);
    });
  }

  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setIsOpen(true)}>
        <Wand2 className="size-4" />
        {t('applyAiCta')}
      </Button>

      <ConfirmDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        title={t('applyAiConfirmTitle')}
        destructive={false}
        confirmLabel={t('applyAiConfirm')}
        cancelLabel={t('applyAiCancel')}
        isPending={isPending}
        onConfirm={handleConfirm}
        description={
          <div className="flex flex-col gap-2">
            <p>{t('applyAiConfirmIntro')}</p>
            <ul className="list-disc pl-5 flex flex-col gap-0.5">
              {available.title ? <li>{t('applyAiFieldTitle')}</li> : null}
              {available.description ? <li>{t('applyAiFieldDescription')}</li> : null}
              {available.tags ? <li>{t('applyAiFieldTags')}</li> : null}
              {available.images ? <li>{t('applyAiFieldImages')}</li> : null}
            </ul>
            <p className="text-xs">{t('applyAiConfirmHistoryNote')}</p>
          </div>
        }
      />
    </>
  );
}
