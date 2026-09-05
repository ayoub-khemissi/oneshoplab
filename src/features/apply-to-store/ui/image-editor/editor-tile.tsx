'use client';

import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Repeat,
  Sparkles,
  Star,
  Tag,
  Trash2
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ElapsedTimer, InfoHint } from '@/shared/ui';
import type { TileActions } from '../../lib/image-editor';
import { AltGenerateButton } from './alt-generate-button';
import { AltTextField } from './alt-text-field';
import { TileButton } from './tile-button';

export interface TileHandlers {
  setFeatured: () => void;
  append: () => void;
  startReplace: () => void;
  remove: () => void;
  saveAlt: (alt: string) => void;
  move: (delta: -1 | 1) => void;
  pick: () => void;
  /** Absent when the page wired no generator in — the button is not shown. */
  generateAlt?: () => Promise<
    { ok: true; alt: string; changeQueued?: boolean } | { ok: false; error: string }
  >;
}

export interface EditorTileProps {
  /** Ref of the photo in the previewed gallery, or `gen:<jobId>` off-gallery. */
  domRef: string;
  label: string;
  src: string;
  alt: string | null;
  kind: 'store' | 'generated';
  isMain: boolean;
  inGallery: boolean;
  actions: TileActions;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /** A replacement is being chosen: this tile is the one being replaced. */
  replacing: boolean;
  /** A replacement is being chosen and this generation can be the answer. */
  pickable: boolean;
  /** "Retirer" is hidden because the product would end up with no photo. */
  removeBlocked: boolean;
  /** Credits one alt-text generation costs, shown on the button. */
  altCost: number;
  /** An alt text for THIS photo is being written right now — read from the job
   *  row, so a refresh resumes it with the real elapsed time instead of
   *  dropping it. */
  altStartedAtMs?: number | null;
  /** A store photo we cannot address yet: applied to the store, but the
   *  catalogue has not come back with its id. Every action is off until then. */
  syncing?: boolean;
  on: TileHandlers;
  onDragStart?: () => void;
  onDrop?: () => void;
}

export function EditorTile(props: EditorTileProps) {
  const t = useTranslations('ProductImages');
  const tAlt = useTranslations('AltText');
  const { actions, on, kind, label } = props;
  const [editingAlt, setEditingAlt] = useState(false);
  // The generated sentence is a PROPOSAL: it opens the same field the merchant
  // types in, and nothing is queued until they save it (IMAGE-OPS.md §4 — alt
  // text never touches their visuals, but it does go on their store).
  const [proposedAlt, setProposedAlt] = useState<string | null>(null);
  const draggable = actions.move;

  return (
    <div
      data-testid="editor-tile"
      data-ref={props.domRef}
      data-kind={kind}
      data-main={props.isMain ? 'true' : 'false'}
      data-gallery={props.inGallery ? 'true' : 'false'}
      draggable={draggable}
      onDragStart={props.onDragStart}
      onDragOver={(e) => {
        if (draggable) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        props.onDrop?.();
      }}
      className={`flex flex-col gap-2 rounded-lg border p-2 ${
        props.replacing
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30'
          : 'border-[var(--border)]'
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded-md bg-[var(--default)]/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={props.src}
          alt={props.alt ?? ''}
          loading="lazy"
          className="size-full object-cover"
        />
        {props.isMain ? (
          <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <Star className="size-3" aria-hidden /> {t('badgeMain')}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium">{label}</span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
            kind === 'store'
              ? 'bg-[var(--default)] text-[var(--muted)]'
              : 'bg-[var(--accent)]/10 text-[var(--accent)]'
          }`}
        >
          {kind === 'store' ? t('badgeStore') : t('badgeGenerated')}
        </span>
        {kind === 'generated' && !props.inGallery ? (
          <span className="text-[10px] text-[var(--muted)]">{t('badgeNotOnProduct')}</span>
        ) : null}
      </div>

      {editingAlt ? (
        <AltTextField
          value={proposedAlt ?? props.alt}
          label={label}
          hint={proposedAlt !== null ? tAlt('generatedNotice') : undefined}
          onSave={(alt) => {
            on.saveAlt(alt);
            setProposedAlt(null);
            setEditingAlt(false);
          }}
          onCancel={() => {
            setProposedAlt(null);
            setEditingAlt(false);
          }}
        />
      ) : (
        <p className="flex items-start gap-1 text-[11px] text-[var(--muted)]">
          <span className="line-clamp-2 min-w-0">{props.alt ? props.alt : t('altMissing')}</span>
          <InfoHint
            topic="altText"
            label={t('altFieldLabel', { photo: label })}
            className="mt-px"
          />
        </p>
      )}

      {props.pickable ? (
        <button
          type="button"
          onClick={on.pick}
          data-testid="tile-pick"
          className="rounded-md bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-[var(--accent-foreground)] hover:opacity-90"
        >
          {t('pickThisVisual')}
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          {actions.setFeatured && !props.isMain ? (
            <TileButton
              onClick={on.setFeatured}
              testId="tile-set-featured"
              icon={<Star className="size-3" />}
            >
              {t('actionSetFeatured')}
            </TileButton>
          ) : null}
          {actions.append ? (
            <TileButton
              onClick={on.append}
              testId="tile-append"
              icon={<ImagePlus className="size-3" />}
            >
              {t('actionAppend')}
            </TileButton>
          ) : null}
          {actions.replace ? (
            <TileButton
              onClick={on.startReplace}
              testId="tile-replace"
              icon={<Repeat className="size-3" />}
            >
              {t('actionReplace')}
            </TileButton>
          ) : null}
          {actions.setAlt && !editingAlt ? (
            <TileButton
              onClick={() => setEditingAlt(true)}
              testId="tile-alt"
              icon={<Tag className="size-3" />}
            >
              {t('actionAlt')}
            </TileButton>
          ) : null}
          {props.altStartedAtMs ? (
            <span className="inline-flex w-full items-center gap-1.5 text-[10px] text-[var(--muted)]">
              <Sparkles className="size-3 shrink-0 animate-pulse" aria-hidden />
              {tAlt('generating')}
              <ElapsedTimer startedAt={props.altStartedAtMs} />
            </span>
          ) : null}
          {actions.setAlt && !editingAlt && on.generateAlt && !props.altStartedAtMs ? (
            <AltGenerateButton
              generate={on.generateAlt}
              cost={props.altCost}
              hasAlt={(props.alt ?? '').trim().length > 0}
              // The generation goes to the store as a change, like every other
              // one: what the merchant validates is the change, not the draft.
              // For a STORE photo the server already queued it — queueing a
              // local copy too is what left a phantom "1 edit to send" behind.
              // A generated image is not on the product yet, so its alt still
              // rides in the local queue with the image itself.
              onGenerated={(alt, changeQueued) => {
                if (!changeQueued) on.saveAlt(alt);
                setProposedAlt(alt);
              }}
            />
          ) : null}
          {actions.remove ? (
            <TileButton
              onClick={on.remove}
              testId="tile-remove"
              icon={<Trash2 className="size-3" />}
              danger
            >
              {t('actionRemove')}
            </TileButton>
          ) : null}
          {props.syncing ? (
            // Silence here read as a broken tile: no buttons, and an alt column
            // saying "none" on a photo that had just been sent to the store.
            <span className="w-full text-[10px] leading-snug text-[var(--muted)]">
              {t('tileSyncing')}
            </span>
          ) : null}
          {props.removeBlocked ? (
            <span className="text-[10px] text-[var(--muted)]" title={t('removeBlocked')}>
              {t('removeBlocked')}
            </span>
          ) : null}
          {actions.move ? (
            <span className="flex w-full gap-1 [&>button]:flex-1">
              <TileButton
                onClick={() => on.move(-1)}
                testId="tile-move-left"
                disabled={!props.canMoveLeft}
                icon={<ArrowLeft className="size-3" />}
                ariaLabel={t('moveLeft', { photo: label })}
              />
              <TileButton
                onClick={() => on.move(1)}
                testId="tile-move-right"
                disabled={!props.canMoveRight}
                icon={<ArrowRight className="size-3" />}
                ariaLabel={t('moveRight', { photo: label })}
              />
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
