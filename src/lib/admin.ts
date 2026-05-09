/**
 * Lightweight admin gate. Driven by the ADMIN_EMAILS env var
 * (comma-separated list, case-insensitive). Avoids a DB role column
 * for the single-admin sales-prospection use case; promote a future
 * users.role schema only when the team grows past one or two admins.
 *
 * Empty / unset env = no admins (everyone is a regular user).
 */
function adminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailSet().has(email.toLowerCase());
}
