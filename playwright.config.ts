import { defineConfig, devices } from '@playwright/test';
import { testDatabaseUrl } from './tests/test-env';

/**
 * Smoke tests of the real app: local = `next dev` on a spare port against the
 * `<db>_test` database (prod .next is never touched); CI = `next start` on the
 * build produced by the workflow. Every external service is pointed at a
 * closed local port so failures are immediate and nothing leaves the box.
 */
const PORT = Number(process.env.E2E_PORT ?? 3031);
const BASE = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: testDatabaseUrl(),
  APP_URL: BASE,
  AUTH_URL: BASE,
  AUTH_SECRET: 'e2e-secret-not-for-production-0123456789',
  AUTH_TRUST_HOST: 'true',
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: '',
  RECAPTCHA_SECRET_KEY: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1',
  DISCORD_BOT_API_URL: 'http://127.0.0.1:1',
  DISCORD_BOT_API_KEY: 'e2e',
  OPENROUTER_API_KEY: '',
  KIE_API_KEY: '',
  R2_ACCOUNT_ID: '',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
  NEXT_PUBLIC_GA_MEASUREMENT_ID: '',
  NEXT_PUBLIC_META_PIXEL_ID: ''
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: isCI ? `pnpm start -p ${PORT}` : `pnpm dev -p ${PORT}`,
    url: `${BASE}/fr`,
    env: E2E_ENV,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
