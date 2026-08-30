import type { GenField } from './generate-button';

export const IMAGE_ANGLES_PER_GEN = 3;

/**
 * App-wide retry policy for AI generations:
 *   - Attempt 1 fires immediately.
 *   - On failure: wait 2s, attempt 2 (label "2/3").
 *   - On failure: wait 5s, attempt 3 (label "3/3").
 *   - On failure: surface the last error message.
 * The user can cancel at any point — during a wait OR during an attempt
 * (`AbortController` on the underlying fetch).
 *
 * Only network errors and 5xx responses are retried. 4xx responses
 * (insufficient_credits, bad_request, …) are terminal — retrying won't
 * help and the message is shown to the user.
 */
export const RETRY_DELAYS_MS = [2000, 5000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 3

export type FieldState =
  | { kind: 'idle' }
  | { kind: 'pending'; attempt: number; startedAt: number }
  | { kind: 'waiting'; nextAttempt: number; resumeAt: number; lastError: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'success' };

export const FIELDS: GenField[] = ['title', 'description', 'tags', 'images', 'all'];

export const IDLE_STATES = (): Record<GenField, FieldState> =>
  FIELDS.reduce(
    (acc, f) => {
      acc[f] = { kind: 'idle' };
      return acc;
    },
    {} as Record<GenField, FieldState>
  );

export function isInflight(s: FieldState): boolean {
  return s.kind === 'pending' || s.kind === 'waiting';
}
