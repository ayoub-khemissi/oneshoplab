/**
 * A modal is part of the navigation — and must not break it.
 *
 * On a phone, Back is how people leave things: a modal owning no history entry
 * makes the system gesture leave the PAGE, costing the merchant the product
 * they were working on.
 *
 * The second half of this file is the more important one. The first attempt at
 * this feature tidied up its history entry with `history.back()`, which walked
 * Next's router tree back while the URL stayed put: after opening ONE modal,
 * every `<Link>` in the app silently did nothing. The smoke passed, because it
 * only ever tested the modal. So every test here ends by clicking a link and
 * checking the app still navigates.
 */
import { expect, test, type Page } from '@playwright/test';
import { SEED } from './seed';

/** The slide-in menu itself — the cookie banner is a `role="dialog"` too. */
const DRAWER = '[data-slot="drawer-dialog"]';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

/** Open the drawer, retrying until the page is interactive (dev hydration). */
async function openDrawer(page: Page) {
  const burger = page.getByRole('button', { name: /menu/i }).first();
  await expect(async () => {
    await burger.click();
    await expect(page.locator(DRAWER)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * The regression the outage taught us: links must still work afterwards.
 *
 * Goes through the drawer rather than the header, because at phone width the
 * header's links are exactly what the drawer exists to replace.
 */
async function expectNavigationStillWorks(page: Page) {
  await openDrawer(page);
  // A react-aria ListBox row, not an <a>: matched by its text.
  await page.locator(DRAWER).getByText('Tableau de bord', { exact: true }).first().click();
  await page.waitForURL(/\/fr\/dashboard\/?(\?.*)?$/, { timeout: 15_000 });
}

test.describe('a modal is part of the navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Back closes the menu, stays on the page, and links keep working', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);

    await openDrawer(page);
    await page.goBack();
    await expect(page.locator(DRAWER)).toHaveCount(0);
    // The whole point: still on the products tab, not back on the dashboard.
    expect(page.url()).toContain('tab=products');

    await expectNavigationStillWorks(page);
  });

  test('closing with the cross leaves the router intact', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);

    await openDrawer(page);
    await page.locator(DRAWER).getByRole('button', { name: /fermer/i }).click();
    await expect(page.locator(DRAWER)).toHaveCount(0);

    await expectNavigationStillWorks(page);
  });

  test('opening and closing repeatedly costs one entry, not one each', async ({ page }) => {
    await login(page);
    const target = `/fr/dashboard/sites/${SEED.project.id}?tab=products`;
    await page.goto(target);
    const before = await page.evaluate(() => history.length);

    for (let i = 0; i < 3; i += 1) {
      await openDrawer(page);
      await page.locator(DRAWER).getByRole('button', { name: /fermer/i }).click();
      await expect(page.locator(DRAWER)).toHaveCount(0);
    }

    // Three open/close cycles, at most one entry — otherwise leaving the page
    // would take as many Back presses as the merchant made openings.
    const after = await page.evaluate(() => history.length);
    expect(after - before).toBeLessThanOrEqual(1);

    await expectNavigationStillWorks(page);
  });

  test('the image style picker closes on Back, on the page it was opened from', async ({
    page
  }) => {
    // The modal the merchant actually reported: it is mounted only while open,
    // so its entry is pushed on mount rather than from an `isOpen` flag.
    await login(page);
    const product = `/fr/dashboard/sites/${SEED.imageProject.id}/products/${SEED.imageProduct.id}`;
    await page.goto(product);

    const modal = page.getByRole('dialog').filter({ hasText: /style|angle|image/i }).first();
    await expect(async () => {
      await page.getByRole('button', { name: /Ajouter une image/i }).first().click();
      await expect(modal).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await page.goBack();
    await expect(modal).toHaveCount(0);
    expect(page.url()).toContain('/products/');

    await expectNavigationStillWorks(page);
  });
});

