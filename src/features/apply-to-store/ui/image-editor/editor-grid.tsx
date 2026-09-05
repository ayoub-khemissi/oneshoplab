'use client';

import type { TileActions } from '../../lib/image-editor';
import type { GridTile } from '../../lib/image-editor-grid';
import { EditorTile, type TileHandlers } from './editor-tile';

/**
 * Layout of the one grid (docs/api/IMAGE-OPS.md §4). It owns no state: the
 * editor decides what each tile may do and what a click means, so the two
 * concerns stay readable apart.
 */
export function EditorGrid({
  tiles,
  galleryLength,
  replaceFor,
  actionsFor,
  removeBlockedFor,
  handlersFor,
  altCost,
  onDragStart,
  onDrop
}: {
  tiles: GridTile[];
  /** Photos in the previewed gallery — bounds the "move right" button. */
  galleryLength: number;
  /** Ref of the photo waiting for a replacement, or null. */
  replaceFor: string | null;
  actionsFor: (tile: GridTile) => TileActions;
  removeBlockedFor: (tile: GridTile) => boolean;
  handlersFor: (tile: GridTile) => TileHandlers;
  /** Credits one alt-text generation costs — shown on each tile's button. */
  altCost: number;
  onDragStart: (tile: GridTile) => void;
  onDrop: (tile: GridTile) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map((tile) => (
        <EditorTile
          key={tile.key}
          domRef={tile.domRef}
          label={tile.label}
          src={tile.src}
          alt={tile.alt}
          kind={tile.kind}
          isMain={tile.position === 0}
          inGallery={tile.inGallery}
          actions={actionsFor(tile)}
          altCost={altCost}
          canMoveLeft={tile.position > 0}
          canMoveRight={tile.position >= 0 && tile.position < galleryLength - 1}
          replacing={replaceFor === tile.domRef}
          pickable={replaceFor !== null && tile.kind === 'generated' && !tile.inGallery}
          removeBlocked={removeBlockedFor(tile)}
          onDragStart={() => onDragStart(tile)}
          onDrop={() => onDrop(tile)}
          on={handlersFor(tile)}
        />
      ))}
    </div>
  );
}
