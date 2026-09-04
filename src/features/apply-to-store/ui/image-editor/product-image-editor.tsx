'use client';

import { AlertTriangle, Check, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { ImageOp } from '@/entities/product-change/client';
import type { ConnectionCapabilities } from '@/shared/db/schema';
import { InfoHint } from '@/shared/ui';
import { approveImageOpsAction } from '../../api/image-ops-actions';
import {
  EMPTY_QUEUE,
  describeOp,
  hasPerImageActions,
  moveRef,
  previewQueue,
  pushOp,
  removeQueuedOp,
  tileActions,
  withAltForSrc,
  type EditorQueue,
  type TileActions
} from '../../lib/image-editor';
import {
  buildGrid,
  type GridGeneratedImage,
  type GridStoreImage
} from '../../lib/image-editor-grid';
import type { AltTextGenerator, ImageOpsResult } from '../../model/types';
import { EditorGrid } from './editor-grid';
import { PendingOpsPanel } from './pending-ops-panel';

export type EditorStoreImage = GridStoreImage;
export type EditorGeneratedImage = GridGeneratedImage;

/** Id of the queue row that stands for "the photos moved" (see below). */
const REORDER_ROW = 'reorder';

const NO_ACTIONS: TileActions = {
  setFeatured: false,
  append: false,
  replace: false,
  remove: false,
  setAlt: false,
  move: false
};

/**
 * The product-page image editor (docs/api/IMAGE-OPS.md §4). One grid mixes the
 * photos already on the store with the visuals OSL generated; each click
 * queues an op, the queue is replayed by the entity's own simulation so the
 * grid IS the preview of the result, and "Appliquer" turns the whole queue
 * into a single pending change.
 *
 * A connection with no stable image ids gets the grid read-only and the §5
 * explanation: the replace-all path, with its guardrail dialog, stays on each
 * generation below.
 */
export function ProductImageEditor({
  productId,
  storeImages,
  generated,
  capabilities,
  archived = false,
  generateAlt
}: {
  productId: string;
  storeImages: EditorStoreImage[];
  generated: EditorGeneratedImage[];
  capabilities: ConnectionCapabilities;
  archived?: boolean;
  /** Server action that writes an alt text for one photo. Wired by the page;
   *  absent = no "generate" button (see AltTextGenerator). */
  generateAlt?: AltTextGenerator;
}) {
  const t = useTranslations('ProductImages');
  const router = useRouter();
  const [queue, setQueue] = useState<EditorQueue>(EMPTY_QUEUE);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [pending, startTransition] = useTransition();
  const opId = useRef(0);
  const dragged = useRef<string | null>(null);

  const editable = hasPerImageActions(capabilities) && !archived;
  const preview = previewQueue(queue, storeImages);
  const galleryRefs = preview.images.map((i) => i.ref);
  const everyStoreImageAddressable = storeImages.every((i) => Boolean(i.sourceImageId));
  const { tiles, namer } = buildGrid({
    storeImages,
    generated,
    previewImages: preview.images,
    altDrafts,
    labels: {
      photo: (n) => t('photoLabel', { n }),
      generated: (n) => t('generatedLabel', { n }),
      fallback: t('photoFallback')
    }
  });

  // A generated visual is meant for the product: it joins the queue by itself,
  // so the merchant validates a result instead of assembling it. Each one is
  // added once — taking it back out of the queue is a decision, and a decision
  // is not undone by a re-render.
  const autoAdded = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!editable) return;
    const fresh = generated.filter(
      (image) => !autoAdded.current.has(image.src) && !storeImages.some((s) => s.src === image.src)
    );
    if (fresh.length === 0) return;
    fresh.forEach((image) => autoAdded.current.add(image.src));
    setQueue((q) =>
      fresh.reduce(
        (acc, image) =>
          pushOp(
            acc,
            { op: 'append', image: { src: image.src, alt: image.alt ?? null } },
            `op-${opId.current++}`
          ),
        q
      )
    );
  }, [generated, storeImages, editable]);

  function queueOp(op: ImageOp) {
    setError(null);
    setApplied(false);
    setQueue((q) => pushOp(q, op, `op-${opId.current++}`));
  }

  function messageFor(res: Extract<ImageOpsResult, { ok: false }>): string {
    switch (res.error) {
      case 'stale':
        return t('errorStale');
      case 'last_image':
        return t('errorLastImage');
      case 'too_many_images':
        return t('errorTooMany', { max: res.max });
      case 'unsupported':
        return t('errorUnsupported');
      case 'archived':
        return t('errorArchived');
      default:
        return t('errorGeneric');
    }
  }

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await approveImageOpsAction(productId, preview.ops);
      if (res.ok) {
        setQueue(EMPTY_QUEUE);
        setApplied(true);
      } else {
        setError(messageFor(res));
        // The gallery moved under the merchant: drop a queue built on the old
        // view and show them the current one rather than guessing.
        if (res.error === 'stale') setQueue(EMPTY_QUEUE);
      }
      router.refresh();
    });
  }

  function dropOn(target: string) {
    const from = dragged.current;
    dragged.current = null;
    if (!from || from === target) return;
    const at = galleryRefs.indexOf(target);
    if (at < 0) return;
    const order = galleryRefs.filter((r) => r !== from);
    order.splice(at, 0, from);
    setQueue((q) => ({ ...q, order }));
  }

  const altOf = (src: string, fallback: string | null) => altDrafts[src] ?? fallback;

  return (
    <section data-testid="image-editor" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
          {t('title')}
          <InfoHint topic="imageResolution" label={t('title')} size="md" />
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('intro')}</p>
      </div>

      {!editable && !archived ? (
        <p
          data-testid="image-editor-fallback"
          className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--default)]/40 p-3 text-sm text-[var(--muted)]"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {capabilities.stableImageIds ? t('noActionsAvailable') : t('fallbackNote')}{' '}
            {t('fallbackHint')}
          </span>
        </p>
      ) : null}

      {tiles.length === 0 ? (
        <p className="text-sm italic text-[var(--muted)]">{t('emptyStore')}</p>
      ) : (
        <EditorGrid
          tiles={tiles}
          galleryLength={galleryRefs.length}
          replaceFor={replaceFor}
          actionsFor={(tile) =>
            editable
              ? tileActions(
                  { ...tile, index: tile.position + 1 },
                  {
                    capabilities,
                    previewCount: preview.images.length,
                    generatedCount: generated.length,
                    everyStoreImageAddressable,
                    inGallery: tile.inGallery
                  }
                )
              : NO_ACTIONS
          }
          removeBlockedFor={(tile) =>
            editable &&
            tile.kind === 'store' &&
            Boolean(tile.sourceImageId) &&
            capabilities.imageOps.includes('remove') &&
            preview.images.length <= 1
          }
          onDragStart={(tile) => {
            dragged.current = tile.domRef;
          }}
          onDrop={(tile) => dropOn(tile.domRef)}
          handlersFor={(tile) => ({
            setFeatured: () =>
              queueOp(
                tile.kind === 'store'
                  ? { op: 'set_featured', target: tile.domRef }
                  : { op: 'set_featured', image: { src: tile.src, alt: altOf(tile.src, tile.alt) } }
              ),
            append: () =>
              queueOp({ op: 'append', image: { src: tile.src, alt: altOf(tile.src, tile.alt) } }),
            startReplace: () => setReplaceFor(tile.domRef),
            remove: () => queueOp({ op: 'remove', target: tile.domRef }),
            move: (delta) =>
              setQueue((q) => ({ ...q, order: moveRef(galleryRefs, tile.domRef, delta) })),
            pick: () => {
              if (!replaceFor) return;
              queueOp({
                op: 'replace',
                target: replaceFor,
                image: { src: tile.src, alt: altOf(tile.src, tile.alt) }
              });
              setReplaceFor(null);
            },
            saveAlt: (alt) => {
              if (tile.kind === 'store') {
                queueOp({ op: 'set_alt', target: tile.domRef, alt });
                return;
              }
              setAltDrafts((d) => ({ ...d, [tile.src]: alt }));
              setQueue((q) => withAltForSrc(q, tile.src, alt));
            },
            // The generation queues its `set_alt` immediately (the tile calls
            // saveAlt with the sentence) and leaves the field open on it —
            // nothing reaches the store until the queue is sent anyway.
            generateAlt: generateAlt ? () => generateAlt(productId, tile.src) : undefined
          })}
        />
      )}

      {replaceFor ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="replace-banner">
          {generated.length === 0 ? t('replacePickEmpty') : t('replacePickTitle')}
          <button
            type="button"
            onClick={() => setReplaceFor(null)}
            className="underline underline-offset-2 hover:text-[var(--danger)]"
          >
            {t('replaceCancel')}
          </button>
        </p>
      ) : null}

      {editable && generated.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">{t('noGenerated')}</p>
      ) : null}
      {preview.invalid ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {preview.invalidReason === 'removes_last_image'
            ? t('previewRemovesLastImage')
            : t('previewInvalid')}
        </p>
      ) : null}

      {/* A product with no photo has nothing to stage: the panel would sit
          there announcing an empty queue the merchant cannot fill from here. */}
      {editable && storeImages.length > 0 ? (
        <PendingOpsPanel
          rows={[
            ...queue.ops.map((q) => ({ id: q.id, description: describeOp(q.op, namer) })),
            // Reordering is one decision however many photos moved, and it is
            // rebuilt on every change — hence its own row rather than a queued op.
            ...(queue.order
              ? [
                  {
                    id: REORDER_ROW,
                    description: describeOp({ op: 'reorder', order: queue.order }, namer)
                  }
                ]
              : [])
          ]}
          pending={pending}
          disabled={preview.ops.length === 0 || preview.invalid}
          onRemove={(id) =>
            setQueue((q) => (id === REORDER_ROW ? { ...q, order: null } : removeQueuedOp(q, id)))
          }
          onClear={() => {
            setQueue(EMPTY_QUEUE);
            setReplaceFor(null);
          }}
          onApply={apply}
        />
      ) : null}

      {applied ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-[var(--success)]" role="status">
          <Check className="size-4" aria-hidden /> {t('applied')}
        </p>
      ) : null}
      {error ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-[var(--danger)]" role="alert">
          <AlertTriangle className="size-4" aria-hidden /> {error}
        </p>
      ) : null}
    </section>
  );
}
