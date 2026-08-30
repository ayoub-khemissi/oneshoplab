/**
 * Server-side translation helper for audit issue codes. Mirrors the
 * client-side `translateIssue` in paginated-products-list.tsx, but
 * usable from React Server Components without pulling in the client-
 * only `useTranslations` hook. Used by the public /share page to
 * surface "Top issues found" inside the collapsible audit-detail
 * block.
 *
 * Issues come from the audit summary with optional `data` payloads
 * (e.g. `{ length: 42 }` for `short_description`). Older audits don't
 * always carry every key the translation expects, so we splat a set
 * of zero defaults to keep ICU formatters happy.
 */
const ISSUE_DEFAULTS: Record<string, string | number> = {
  length: 0,
  missing: 0,
  total: 0,
  width: 0
};

export function translateIssueText(
  tIssues: (key: string, values?: Record<string, string | number>) => string,
  issue: { code: string; data?: Record<string, string | number> }
): string {
  const values = { ...ISSUE_DEFAULTS, ...(issue.data ?? {}) };
  try {
    return tIssues(issue.code, values);
  } catch {
    return issue.code.replace(/_/g, ' ');
  }
}
