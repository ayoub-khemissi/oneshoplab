import type { ImageJobRow } from '@/entities/generation-job';

/** Map a server error code to the matching translation key. Falls back
 *  to a generic message when the code isn't one we explicitly handle. */
export function errorKeyFromCode(code: string | undefined): string {
  switch (code) {
    case 'insufficient_credits':
      return 'errorInsufficientCredits';
    case 'no_source_image':
      return 'errorNoSourceImage';
    case 'image_cap_reached':
      return 'errorCapReached';
    default:
      return 'errorGeneric';
  }
}

/** JSON.parse strips Date objects to strings — restore them for any
 *  field the UI does math on. */
export function rehydrateDates(j: ImageJobRow): ImageJobRow {
  return {
    ...j,
    createdAt: new Date(j.createdAt),
    startedAt: j.startedAt ? new Date(j.startedAt) : null,
    finishedAt: j.finishedAt ? new Date(j.finishedAt) : null
  };
}
