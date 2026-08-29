/**
 * Strips internal vendor names and tool jargon from an error message before
 * showing it to a user. Raw error stays in the DB for ops debugging; this
 * helper only runs at display time.
 *
 * Rules:
 *   - Drop known prefixes like "kie chat failed:", "kie createTask failed:" …
 *   - Replace bare mentions of "kie" / "kie.ai" with a neutral "AI service"
 *   - Trim and collapse whitespace
 *   - If nothing readable is left, return a generic fallback
 */
export function sanitizeUserFacingError(raw: string | null | undefined): string {
  if (!raw) return 'Generation failed. Please try again.';
  let msg = raw.trim();

  msg = msg.replace(
    /^((kie|openrouter)\s+\S+\s+failed:\s*)/i,
    ''
  );

  msg = msg.replace(/\bkie\.ai\b/gi, 'AI service');
  msg = msg.replace(/\bkie\b/gi, 'AI service');
  msg = msg.replace(/\bopenrouter\b/gi, 'AI service');

  msg = msg.replace(/\s+/g, ' ').trim();

  if (msg.length < 4) return 'Generation failed. Please try again.';
  return msg;
}
