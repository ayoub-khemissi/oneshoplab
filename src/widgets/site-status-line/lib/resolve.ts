/**
 * One line, one message.
 *
 * Four separate cards used to speak about the same subject — the state of this
 * store — and could all render at once: the audit status, the "changes are
 * waiting" banner, the catalogue-arriving notice, and the onboarding guide. On
 * a phone that is four blocks of chrome before the product list, which is what
 * the merchant actually came for.
 *
 * So they collapse into a single line that shows the most urgent thing only.
 * The order below is not cosmetic: it goes from "the machine is working, wait"
 * through "something needs your attention" down to "here is your next step",
 * so the line never asks for an action while something is still moving.
 */

export type SiteStatusKind =
  | 'auditRunning'
  | 'catalogArriving'
  | 'auditFailed'
  | 'changesToReview'
  | 'changesSending'
  | 'connectStore'
  | 'applyFirstChange';

export type SiteStatusTone = 'busy' | 'danger' | 'accent';

export interface SiteStatus {
  kind: SiteStatusKind;
  tone: SiteStatusTone;
  /** Populated for the two counted messages, so the line can say how many. */
  count?: number;
  /** Where the line takes the merchant, when it leads anywhere. */
  target?: 'integrations' | 'products' | 'changes';
}

export interface SiteStatusInput {
  /** The audit the page is rendering, promoted to `failed` when it read nothing. */
  auditStatus: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  /** The store is handing us its catalogue right now. */
  catalogArriving: boolean;
  /** A live integration exists — a failure then means something else broke. */
  connected: boolean;
  /** At least one change has landed in the store. */
  applied: boolean;
  pending: number;
  /** Conflicts and failures: settled, and the merchant's to act on. */
  toReview: number;
  /** Manual catalogues never go through a fetch lifecycle. */
  manual: boolean;
}

export function resolveSiteStatus(input: SiteStatusInput): SiteStatus | null {
  if (input.manual) {
    // No store to fetch from and nothing to connect: only the change flow can
    // have something to say here.
    if (input.toReview > 0)
      return { kind: 'changesToReview', tone: 'danger', count: input.toReview, target: 'changes' };
    if (input.pending > 0)
      return { kind: 'changesSending', tone: 'busy', count: input.pending, target: 'changes' };
    return null;
  }

  if (input.auditStatus === 'pending' || input.auditStatus === 'running') {
    return { kind: 'auditRunning', tone: 'busy' };
  }
  if (input.catalogArriving) return { kind: 'catalogArriving', tone: 'busy' };

  // A failure on a store nobody connected is not reported here: it is answered
  // by the connect card, which owns that moment entirely.
  if (input.auditStatus === 'failed' && input.connected) {
    return { kind: 'auditFailed', tone: 'danger' };
  }

  if (input.toReview > 0) {
    return { kind: 'changesToReview', tone: 'danger', count: input.toReview, target: 'changes' };
  }
  if (input.pending > 0) {
    return { kind: 'changesSending', tone: 'busy', count: input.pending, target: 'changes' };
  }

  // The onboarding path, last: it is the least urgent thing on the page, and
  // it is the one that used to take the most room.
  if (!input.connected) return { kind: 'connectStore', tone: 'accent', target: 'integrations' };
  if (!input.applied) return { kind: 'applyFirstChange', tone: 'accent', target: 'products' };
  return null;
}
