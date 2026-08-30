/**
 * Shared by setup-env (per worker) and global-setup (once): derive the test
 * DATABASE_URL from .env by swapping the database name for `<name>_test`, and
 * refuse to run against anything that isn't a *_test database.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadDotEnv(): Record<string, string> {
  // cwd-based (not import.meta) so both vitest and the Playwright config (CJS) can load it.
  const path = resolve(process.cwd(), '.env');
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? loadDotEnv().DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base)
    throw new Error('No DATABASE_URL / TEST_DATABASE_URL to derive the test database from');
  const url = new URL(base);
  if (!explicit) url.pathname = url.pathname.replace(/\/?$/, '') + '_test';
  if (!url.pathname.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against ${url.pathname}: database name must end in _test`
    );
  }
  return url.toString();
}
