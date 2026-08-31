'use client';

import { ArrowLeft, ArrowRight, ImagePlus, Repeat, Star, Tag, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { TileActions } from '../../lib/image-editor';
import { AltTextField } from './alt-text-field';

export interface TileHandlers {
  setFeatured: () => void;
  append: () => void;
  startReplace: () => void;
  remove: () => void;
  saveAlt: (alt: string) => void;
  move: (delta: -1 | 1) => void;
  pick: () => void;
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
  on: TileHandlers;
  onDragStart?: () => void;
  onDrop?: () => void;
}

export function EditorTile(props: EditorTileProps) {
  const t = useTranslations('ProductImages');
  const { actions, on, kind, label } = props;
  const [editingAlt, setEditingAlt] = useState(false);
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
          value={props.alt}
          label={label}
          onSave={(alt) => {
            on.saveAlt(alt);
            setEditingAlt(false);
          }}
          onCancel={() => setEditingAlt(false)}
        />
      ) : (
        <p className="line-clamp-2 text-[11px] text-[var(--muted)]">
          {props.alt ? props.alt : t('altMissing')}
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
        <div className="flex flex-wrap gap-1">
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
          {props.removeBlocked ? (
            <span className="text-[10px] text-[var(--muted)]" title={t('removeBlocked')}>
              {t('removeBlocked')}
            </span>
          ) : null}
          {actions.move ? (
            <span className="flex gap-1">
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

function TileButton({
  onClick,
  testId,
  icon,
  children,
  danger = false,
  disabled = false,
  ariaLabel
}: {
  onClick: () => void;
  testId: string;
  icon: ReactNode;
  children?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-1 text-[11px] disabled:opacity-40 ${
        danger
          ? 'hover:border-[var(--danger)] hover:text-[var(--danger)]'
          : 'hover:border-[var(--accent)] hover:text-[var(--accent)]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
