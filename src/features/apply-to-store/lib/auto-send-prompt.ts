/**
 * Whether to ask the merchant, right after connecting a store, if changes
 * should be sent automatically.
 *
 * Asked once, at the moment it becomes a real question: before the store is
 * connected there is nothing to send to, and after either answer the setting
 * in the site's preferences is the place to change one's mind. The prompt is
 * the same switch, offered where the merchant is standing when it first
 * matters.
 */
export function shouldAskAutoSend(input: {
  connected: boolean;
  decidedAt: Date | null | undefined;
  /** Manual catalogues have no store to send to. */
  manual: boolean;
}): boolean {
  return input.connected && !input.manual && input.decidedAt == null;
}
