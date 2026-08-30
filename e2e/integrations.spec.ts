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

  test('Shopify branch keeps the token form when the public app is not configured', async ({
    page
  }) => {
    // The e2e env has no SHOPIFY_APP_CLIENT_ID: no install card, no "other method" collapsible.
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations`);
    await page.getByRole('radio', { name: /Shopify/ }).click();
    await expect(page.getByTestId('shopify-install-card')).toHaveCount(0);
    await expect(page.getByTestId('shopify-token-method')).toHaveCount(0);
    await expect(page.getByText('Collez votre jeton d’accès')).toBeVisible();
    await expect(page.getByTestId('integration-return')).toHaveCount(0);
  });

  test('Wix branch shows coming soon while the Wix app is not configured', async ({ page }) => {
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations`);
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    await page.getByRole('radio', { name: /Wix/ }).click();
    await expect(page.getByText('Bientôt disponible')).toBeVisible();
    await expect(page.getByRole('switch')).toBeVisible();
    await expect(page.getByTestId('wix-install')).toHaveCount(0);
    await expect(page.getByTestId('wix-connection')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE/);
  });

  test('OAuth return params show a banner and are stripped from the URL', async ({ page }) => {
    await page.goto(
      `/fr/dashboard/sites/${SEED.project.id}?tab=integrations&connected=shopify&warning=webhooks_failed`
    );
    const notice = page.getByTestId('integration-return');
    await expect(notice).toHaveAttribute('data-kind', 'warning');
    await expect(notice).toContainText('temps réel');
    await expect(page).not.toHaveURL(/connected=/);

    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations&error=bad_state`);
    await expect(page.getByTestId('integration-return')).toHaveAttribute('data-kind', 'error');
    await expect(page.getByTestId('integration-return')).toContainText('Relancez');
  });

  test('Avancé section lists no webhook and refuses an http:// address', async ({ page }) => {
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=integrations`);
    const section = page.getByTestId('webhooks-section');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('webhook-list')).toHaveCount(0);
    await section.locator('summary').click();
    await expect(section).toContainText('Recevoir les changements immédiatement');
    await expect(section.getByTestId('webhook-list-empty')).toBeVisible();
    await expect(section).toContainText('Aucun envoi');

    const form = section.getByTestId('manual-webhook-form');
    // The SSRF guard rejects the scheme before any DNS lookup — the action is real.
    await form.locator('input[name="url"]').fill('http://example.com/hook');
    await form.getByRole('button', { name: 'Ajouter cette adresse' }).click();
    await expect(section.getByTestId('manual-webhook-error')).toContainText(
      'doit commencer par https://'
    );
    await expect(section.getByTestId('webhook-secret')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE/);
  });
});

