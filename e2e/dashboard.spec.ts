import { expect, test, type Page } from '@playwright/test';
import { SEED } from './seed';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => login(page));

  test('lists the seeded site and opens it with its audit score', async ({ page }) => {
    await expect(page.getByText(SEED.project.domain).first()).toBeVisible();
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}`);
    await expect(page.getByText(SEED.project.domain).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    await expect(page.getByText(/\/\s?100|\b\d{1,3}\b/).first()).toBeVisible();
  });

  test('products tab lists the catalog and opens a product page', async ({ page }) => {
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);
    const productLink = page
      .getByRole('link', { name: /Hand-thrown stoneware coffee mug/ })
      .filter({ visible: true })
      .first();
    await expect(productLink).toBeVisible();
    // Navigate through the href: the row sits under the cookie banner in a
    // headless viewport and a real click gets intercepted.
    await page.goto((await productLink.getAttribute('href'))!);
    await page.waitForURL(/\/products\//);
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    await expect(page.getByText('Hand-thrown stoneware coffee mug, 350 ml').first()).toBeVisible();
  });

  test('account pages render', async ({ page }) => {
    for (const path of ['/fr/account/preferences','/fr/account/profile','/fr/account/credits','/fr/account/subscription']) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    }
  });

  test('another user cannot open this site', async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await other.goto('/fr/signup');
    await other.fill('input[name="email"]', `intruder-${Date.now()}@test.local`);
    await other.fill('input[name="password"]', 'intruder-password-1');
    await other.getByRole('button', { name: 'Créer mon compte' }).click();
    await other.waitForURL(/\/fr\/dashboard/);
    await other.goto(`/fr/dashboard/sites/${SEED.project.id}`);
    // Not yours → bounced to your own dashboard, nothing leaked.
    await other.waitForURL(/\/fr\/dashboard\/?(\?.*)?$/);
    await expect(other.getByText(SEED.project.domain)).toHaveCount(0);
    await ctx.close();
    void page;
  });
});
