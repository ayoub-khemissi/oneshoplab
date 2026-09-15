/**
 * Phone layout guard for the surfaces that changed: the image-format picker
 * (account preferences, product page, bulk wizard) and the site header.
 *
 * One assertion, repeated: the PAGE must not be draggable sideways. It is
 * checked by actually scrolling the window, because `scrollWidth` reports
 * content that an inner scroller already clips and would pass a page that
 * visibly breaks.
 */
import { expect, test, type Page } from '@playwright/test';
import { SEED } from './seed';

const PHONE = { width: 390, height: 844 };

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    window.scrollTo(500, 0);
    const moved = window.scrollX > 0;
    window.scrollTo(0, 0);
    return moved;
  });
}

test.describe('phone layout', () => {
  test.use({ viewport: PHONE });

  const PAGES: Array<[string, string]> = [
    ['dashboard', '/fr/dashboard'],
    ['site', `/fr/dashboard/sites/${SEED.project.id}`],
    ['site settings', `/fr/dashboard/sites/${SEED.project.id}?tab=settings`],
    ['catalogue export', `/fr/dashboard/sites/${SEED.project.id}/export`],
    ['account preferences', '/fr/account/preferences']
  ];

  for (const [name, path] of PAGES) {
    test(`${name} does not drag sideways`, async ({ page }) => {
      await login(page);
      await page.goto(path);
      await expect(page.locator('main, body')).not.toHaveCount(0);
      expect(await pageScrollsSideways(page)).toBe(false);
    });
  }

  test('the image format options wrap instead of widening the page', async ({ page }) => {
    await login(page);
    await page.goto('/fr/account/preferences');

    // Every format option must sit inside the viewport once wrapped.
    const options = page.getByRole('button', { name: /1:1|9:16|16:9/ });
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await options.nth(i).boundingBox();
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 1);
    }
    expect(await pageScrollsSideways(page)).toBe(false);
  });
});
