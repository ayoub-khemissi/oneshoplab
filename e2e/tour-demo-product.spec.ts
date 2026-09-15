/**
 * The tour's product steps land on the REAL product page.
 *
 * The first attempt drew an imitation of a product sheet over the page. A
 * tester said it looked nothing like the real thing, and they were right: it
 * taught a layout that does not exist. The resolver route now opens the
 * merchant's own first product, or a built-in sample rendered by the real
 * page — inert, so nothing can be generated from it.
 */
import { expect, test, type Page } from '@playwright/test';
import { SEED } from './seed';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

test('the resolver opens the merchant’s own product when there is one', async ({ page }) => {
  await login(page);
  await page.goto(`/fr/dashboard/sites/${SEED.project.id}/products/first`);

  // A real product id, not the sample.
  await page.waitForURL(/\/products\/(?!first|demo)[\w-]+/);
  await expect(page.getByTestId('demo-product-banner')).toHaveCount(0);
  await expect(page.locator('main')).not.toHaveAttribute('inert', /.*/);
});

test('the sample sheet is the real page, and nothing on it can be used', async ({ page }) => {
  await login(page);
  await page.goto(`/fr/dashboard/sites/${SEED.project.id}/products/demo`);

  await expect(page.getByTestId('demo-product-banner')).toBeVisible();
  // The real page: the same anchors the tour points at on a real product.
  await expect(page.locator('[data-tour="model-chips"]').first()).toBeVisible();
  await expect(page.locator('#field-title')).toBeVisible();
  await expect(page.getByText('Classic Crew Neck T-Shirt for Men and Women').first()).toBeVisible();
  // Bundled photograph, not a third-party CDN.
  await expect(page.locator('img[src*="demo-tshirt"], img[src*="tour%2Fdemo"]').first()).toBeVisible();

  // Inert: the whole sheet is out of reach, so no generation, no credit.
  await expect(page.locator('main')).toHaveAttribute('inert', /.*/);
});

test('the tour never breaks server rendering of the page it mounts on', async ({ page }) => {
  // The overlay measures the viewport and portals into document.body. Doing
  // that during render threw "window is not defined" on the server, and React
  // answered by dropping the whole page to client rendering — on every
  // dashboard page, for everyone, silently. Caught only by reading the dev
  // server's own complaint, so it is asserted here.
  const fallbacks: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Switched to client rendering|window is not defined/.test(text)) fallbacks.push(text);
  });

  await login(page);
  await page.goto(`/fr/dashboard/sites/${SEED.project.id}`);
  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.goto(`/fr/dashboard/sites/${SEED.project.id}/products/demo`);
  await expect(page.getByTestId('demo-product-banner')).toBeVisible();

  expect(fallbacks).toEqual([]);
});
