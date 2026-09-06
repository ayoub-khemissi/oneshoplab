/**
 * On a phone, Back is how people leave things.
 *
 * A modal that owns no history entry makes the system Back gesture leave the
 * PAGE instead — the merchant loses the product they were working on just to
 * dismiss a dialog. So an open modal pushes its own entry, and Back pops it.
 *
 * Two halves matter equally, and only a real browser can tell them apart:
 * Back must close the modal AND leave the merchant on the same page; and
 * closing with the cross must give the entry back, or the next Back press is
 * spent undoing a modal nobody can see.
 */
import { expect, test, type Page } from '@playwright/test';

/** The slide-in menu itself — the cookie banner is a `role="dialog"` too. */
const DRAWER = '[data-slot="drawer-dialog"]';
import { SEED } from './seed';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

const PHONE = { width: 390, height: 844 };

test.describe('a modal is part of the navigation', () => {
  test.use({ viewport: PHONE });

  test('Back closes the mobile menu and stays on the page', async ({ page }) => {
    await login(page);
    const target = `/fr/dashboard/sites/${SEED.project.id}?tab=products`;
    await page.goto(target);

    const burger = page.getByRole('button', { name: /menu/i }).first();
    await expect(async () => {
      await burger.click();
      await expect(page.locator(DRAWER)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await page.goBack();
    await expect(page.locator(DRAWER)).toHaveCount(0);
    // The whole point: still on the products tab, not back on the dashboard.
    expect(page.url()).toContain('tab=products');
  });

  test('closing with the cross leaves Back working normally', async ({ page }) => {
    await login(page);
    const first = `/fr/dashboard/sites/${SEED.project.id}`;
    await page.goto(first);
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);

    const burger = page.getByRole('button', { name: /menu/i }).first();
    await expect(async () => {
      await burger.click();
      await expect(page.locator(DRAWER)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    // Cross, not Back — the entry the modal pushed must be handed back.
    // Scoped to the drawer: the cookie banner has a "Fermer" of its own, and
    // it sits behind the backdrop.
    await page.locator(DRAWER).getByRole('button', { name: /fermer/i }).click();
    await expect(page.locator(DRAWER)).toHaveCount(0);

    // So this Back is the page's, and it reaches the previous page.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`sites/${SEED.project.id}$`));
  });
});
