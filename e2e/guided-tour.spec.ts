/**
 * The walkthrough, driven in a real browser.
 *
 * Everything else about the tour is arithmetic and can be unit-tested; what
 * cannot is whether the overlay actually appears over the page, finds the
 * element it names, and leaves when asked. That is exactly the part a
 * merchant meets first.
 */
import { expect, test, type Page } from '@playwright/test';
import { SEED } from './seed';

const TOUR = '[data-testid="guided-tour"]';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

test.describe('the first-store walkthrough', () => {
  test('opens by itself for a brand-new account and lights up the audit button', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/fr/signup');
    await page.fill('input[name="email"]', `tour-${Date.now()}@test.local`);
    await page.fill('input[name="password"]', 'tour-password-1');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForURL(/\/fr\/dashboard/);

    // Step one has nothing to point at, so the card sits in the middle.
    const tour = page.locator(TOUR);
    await expect(tour).toHaveAttribute('data-step', 'welcome');

    // Step two must find the real button, not fall back to the centre.
    await page.locator('[data-testid="tour-next"]').click();
    await expect(tour).toHaveAttribute('data-step', 'audit');
    await expect(page.locator('[data-tour="audit-cta"]')).toBeVisible();

    // And it must be leavable, for good.
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    await page.reload();
    await expect(page.locator(TOUR)).toHaveCount(0);
    await ctx.close();
  });

  test('shows a sample product, and opens the account menu it points at', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/fr/signup');
    await page.fill('input[name="email"]', `tour-demo-${Date.now()}@test.local`);
    await page.fill('input[name="password"]', 'tour-password-1');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForURL(/\/fr\/dashboard/);

    const tour = page.locator(TOUR);
    const next = page.locator('[data-testid="tour-next"]');
    const stepOn = async (id: string) => {
      while ((await tour.getAttribute('data-step')) !== id) await next.click();
    };

    // This account has no store and no catalogue, so the product step has an
    // empty page to point at: it must draw the example instead.
    await stepOn('product');
    await expect(page.locator('[data-testid="tour-demo"]')).toBeVisible();

    // The last step is about what is INSIDE the account menu, so the tour
    // opens it — a spotlight on a shut dropdown explains nothing.
    await stepOn('tips');
    const avatar = page.locator('[data-tour="account-menu"]');
    await expect(avatar).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[role="menu"]')).toBeVisible();

    // And leaving the step puts the page back the way it was found.
    await page.locator('[aria-label="Précédent"]').click();
    await expect(tour).not.toHaveAttribute('data-step', 'tips');
    await expect(avatar).toHaveAttribute('aria-expanded', 'false');
    await ctx.close();
  });

  test('never opens by itself for an account that already runs several stores', async ({
    page
  }) => {
    await login(page);
    await expect(page.locator(TOUR)).toHaveCount(0);
  });

  test('a replayed chapter runs only that chapter, then ends', async ({ page }) => {
    await login(page);
    await page.goto('/fr/account/preferences');
    // `next dev` hydrates a beat after paint, and a click that lands before
    // that is simply lost. Retrying is the honest wait: the assertion is that
    // the button eventually works, not that it works on the first frame.
    // (A production build hydrates far sooner; this is a dev-server artefact.)
    await expect(async () => {
      await page.locator('[data-testid="replay-connect"]').click();
      await expect(page.getByRole('status')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    // Replaying from the preferences lands on the dashboard, where this
    // chapter's first step does not live: the primary button must go to THAT
    // step's page, not skip ahead to the following one.
    await page.goto('/fr/dashboard');
    const tour = page.locator(TOUR);
    await expect(tour).toHaveAttribute('data-step', 'connect');
    const travel = page.locator('[data-testid="tour-next"]');
    await expect(travel).toHaveAttribute('data-travel', 'true');
    await travel.click();
    await page.waitForURL(/\/dashboard\/sites\//);
    // Still on the step it was sent to, never the one after it.
    await expect(tour).toHaveAttribute('data-step', 'connect');

    // Two steps, and the second is the last one of the run — the chapter must
    // not walk on into the products or the generation.
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}`);
    await expect(tour).toHaveAttribute('data-step', 'connect');
    const next = page.locator('[data-testid="tour-next"]');
    await expect(next).toHaveAttribute('data-last', 'false');

    await next.click();
    await expect(tour).toHaveAttribute('data-step', 'platform');
    await expect(page).toHaveURL(/tab=integrations/);
    await expect(next).toHaveAttribute('data-last', 'true');

    await next.click();
    await expect(page.locator(TOUR)).toHaveCount(0);
  });
});
