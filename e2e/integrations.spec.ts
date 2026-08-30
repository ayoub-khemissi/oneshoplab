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

    // The seeded project is Shopify — switch to WooCommerce to reach the key step.
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

  test('Shopify branch shows the connect form and refuses a bad domain offline', async ({
    page
  }) => {
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations`);
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    await page.getByRole('radio', { name: /Shopify/ }).click();
    await expect(page.locator('[data-mock]')).toHaveCount(5);
    await expect(page.getByText('Bientôt disponible')).toHaveCount(0);
    await expect(page.getByText('Collez votre jeton d’accès')).toBeVisible();

    const form = page.getByTestId('shopify-connect-form');
    await expect(form).toBeVisible();
    const domain = form.locator('input[name="shopDomain"]');
    // The seeded domain is a custom one, so nothing is prefilled.
    await expect(domain).toHaveValue('');
    await expect(page.getByText('Se termine par .myshopify.com')).toBeVisible();

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST') requests.push(r.url());
    });
    await domain.fill('example.com');
    await form.locator('input[name="accessToken"]').fill('shpat_' + 'x'.repeat(32));
    await page.getByRole('button', { name: 'Connecter ma boutique' }).click();
    await expect(page.getByTestId('shopify-connect-error')).toContainText('.myshopify.com');
    expect(requests).toEqual([]);
    await expect(page.getByTestId('shopify-connection')).toHaveCount(0);
  });
});
