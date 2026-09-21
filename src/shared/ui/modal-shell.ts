/**
 * Layout of every hand-rolled dialog (the ones not built on HeroUI's
 * <Modal>): a centred panel on desktop, the whole screen on a phone. The
 * phone rule for HeroUI's own modals lives in globals.css (same breakpoint,
 * same result) so the two families behave identically.
 *
 * The panel must be `relative` (it is) so <ModalCloseButton> pins to its
 * top-right corner — the one way out on every screen size.
 */
export const MODAL_OVERLAY_CLASS =
  'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4';

const PANEL_WIDTH = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  '2xl': 'sm:max-w-2xl'
} as const;

export type ModalPanelWidth = keyof typeof PANEL_WIDTH;

/** `extra` is for the panel's own layout (padding, gap); size and chrome
 *  come from here so a phone always gets the full screen. */
export function modalPanelClass(width: ModalPanelWidth, extra = ''): string {
  return [
    'relative bg-[var(--background)] shadow-2xl flex flex-col w-full',
    'h-full max-h-none rounded-none border-0',
    'sm:h-auto sm:max-h-[85vh] sm:rounded-lg sm:border sm:border-[var(--border)]',
    PANEL_WIDTH[width],
    extra
  ]
    .filter(Boolean)
    .join(' ');
}
