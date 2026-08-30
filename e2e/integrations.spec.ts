import { expect, test, type Page } from '@playwright/test';
import { SEED } from './seed';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

test.describe('integrations', () => {
  test.beforeEach(async ({ page }) => login(page));

  test('wizard creates a site key and waits for the plugin', async ({ page }) => {
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations`);
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    await expect(page.getByText('Connectez votre boutique').first()).toBeVisible();

    // The seeded project is Shopify (coming soon) — switch to WooCommerce to reach the key step.
    await page.getByRole('radio', { name: /WooCommerce/ }).click();
    await expect(page.locator('[data-mock]')).toHaveCount(4);
    await expect(page.locator('[data-download-plugin]')).toHaveAttribute(
      'href',
      '/downloads/oneshoplab-wp-plugin.zip'
    );
    await page.getByRole('button', { name: 'Créer ma clé du site' }).click();

    const plaintext = page.getByTestId('site-key-plaintext');
    await expect(plaintext).toBeVisible();
    await expect(plaintext).toHaveText(/^osl_live_[A-Za-z0-9_-]{43}$/);
    await page.getByRole('button', { name: 'Je l’ai enregistrée' }).click();
    await expect(plaintext).toHaveCount(0);

    const status = page.getByTestId('connection-status');
    await expect(status).toHaveAttribute('data-state', 'waiting');
    await expect(status).toContainText('En attente du premier échange');
    await expect(page.getByText('Vos clés du site')).toBeVisible();
  });
});
