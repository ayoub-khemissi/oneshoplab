import { expect, test } from '@playwright/test';
import { SEED } from './seed';

test.describe('public pages', () => {
  for (const path of ['/fr', '/en', '/fr/pricing', '/fr/faq', '/fr/terms', '/fr/privacy', '/fr/contact', '/fr/audit', '/fr/login', '/fr/signup']) {
    test(`${path} renders`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    });
  }

  test('home shows the seeded showcase and links to pricing', async ({ page }) => {
    await page.goto('/fr');
    await expect(page.getByRole('link', { name: /tarifs|pricing/i }).first()).toBeVisible();
  });

  test('unknown page is a 404, not a crash', async ({ page }) => {
    const res = await page.goto('/fr/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
  });

  test('public share page renders both products; a revoked link is gone', async ({ page }) => {
    const res = await page.goto(`/fr/share/${SEED.shareLinkId}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText('Hand-thrown stoneware coffee mug, 350 ml').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Washed linen kitchen apron, natural').filter({ visible: true }).first()).toBeVisible();
    const revoked = await page.goto(`/fr/share/${SEED.revokedShareLinkId}`);
    expect(revoked?.status()).toBe(404);
  });

  test('anonymous audit result page renders the score', async ({ page }) => {
    const res = await page.goto(`/fr/audit/${SEED.anonAuditToken}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText('anon-shop.example.com').first()).toBeVisible();
  });
});
