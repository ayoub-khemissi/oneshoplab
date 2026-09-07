/**
 * The moment a store becomes connected is the moment "send automatically?"
 * becomes a real question — so it is asked there, once. Either answer ends it:
 * "no" must not bring it back on the next visit, and the switch in the site's
 * settings remains the place to change one's mind.
 */
import { expect, test, type Page } from '@playwright/test';
import mysql from 'mysql2/promise';
import { E2E_ENV } from '../playwright.config';
import { SEED } from './seed';

const INTEGRATIONS = `/fr/dashboard/sites/${SEED.pendingProject.id}?tab=integrations`;

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

/** Back to "never asked": the previous run answered, and answers stick. */
async function forgetDecision() {
  const conn = await mysql.createConnection({ uri: E2E_ENV.DATABASE_URL });
  try {
    await conn.execute(
      'UPDATE projects SET auto_apply = 0, auto_apply_decided_at = NULL WHERE id = ?',
      [SEED.pendingProject.id]
    );
  } finally {
    await conn.end();
  }
}

test.describe('asking about automatic sending', () => {
  test.beforeEach(async ({ page }) => {
    await forgetDecision();
    await login(page);
  });

  test('a connected store is asked once, and "no" is remembered', async ({ page }) => {
    await page.goto(INTEGRATIONS);
    const prompt = page.getByTestId('auto-send-prompt');
    await expect(prompt).toBeVisible();

    await expect(async () => {
      await page.getByTestId('auto-send-prompt-no').click();
      await expect(page.getByTestId('auto-send-prompt-done')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await page.reload();
    await expect(page.getByTestId('auto-send-prompt')).toHaveCount(0);
    await expect(page.getByTestId('auto-send-prompt-done')).toHaveCount(0);
  });

  test('"yes" flips the same switch the settings show', async ({ page }) => {
    await page.goto(INTEGRATIONS);
    await expect(async () => {
      await page.getByTestId('auto-send-prompt-yes').click();
      await expect(page.getByTestId('auto-send-prompt-done')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await page.goto(`/fr/dashboard/sites/${SEED.pendingProject.id}?tab=settings`);
    await expect(page.getByTestId('auto-send-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  test('a store nobody connected is not asked', async ({ page }) => {
    // The default project has no plugin key and no connector.
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations`);
    await expect(page.getByTestId('auto-send-prompt')).toHaveCount(0);
  });
});
