/**
 * The tab bar shrinks as you scroll — and shrinking moves the page it is
 * measuring against. Land on exactly the wrong pixel and it used to flip
 * between its two sizes for ever, which is how a merchant found it.
 *
 * This walks the scroll positions around the threshold and watches the bar
 * hold still. A settled bar reports the same `data-compact` for a second and
 * a half; a looping one changes several times a second.
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

/**
 * The same watch, at the very bottom of the page.
 *
 * This is where the feedback actually closes: shrinking the bar makes the
 * document shorter, the browser clamps the scroll position down to the new
 * maximum — a scroll change nobody asked for — and a dead zone narrower than
 * the bar's own height sends it straight back the other way.
 */
async function flipsAtBottom(page: Page): Promise<number> {
  return page.evaluate(async () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior });
    const bar = document.querySelector('[data-compact]');
    if (!bar) return -1;
    // Past the transition AND the bar's own settle window, so a single
    // correction after landing counts as settling, not as flapping.
    await new Promise((r) => setTimeout(r, 900));
    let last = bar.getAttribute('data-compact');
    let flips = 0;
    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const now = bar.getAttribute('data-compact');
      if (now !== last) flips += 1;
      last = now;
    }
    return flips;
  });
}

/** How many times the bar changed size while nobody was scrolling. */
async function flipsWhileStill(page: Page, y: number): Promise<number> {
  return page.evaluate(async (top) => {
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
    const bar = document.querySelector('[data-compact]');
    if (!bar) return -1;
    await new Promise((r) => setTimeout(r, 900)); // past the transition and the settle window
    let last = bar.getAttribute('data-compact');
    let flips = 0;
    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const now = bar.getAttribute('data-compact');
      if (now !== last) flips += 1;
      last = now;
    }
    return flips;
  }, y);
}

test.describe('the sticky tab bar', () => {
  for (const [name, viewport] of [
    ['on a phone', { width: 390, height: 844 }],
    ['on a desktop', { width: 1280, height: 800 }]
  ] as const) {
    test(`holds still around the threshold, ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await login(page);
      await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);
      await expect(page.locator('[data-compact]')).toBeVisible();

      // Every pixel in the band where the bar makes up its mind, plus the
      // settled ground either side of it.
      for (const y of [0, 20, 40, 55, 58, 59, 60, 61, 62, 65, 70, 80, 100, 140]) {
        expect(await flipsWhileStill(page, y), `oscillated at scrollY=${y}`).toBe(0);
      }
    });
  }

  test('holds still at the bottom of a short page', async ({ page }) => {
    // A page barely taller than the viewport puts the merchant's scroll
    // position AT the maximum, so the bar's own resize drags it — the
    // condition the reported loop needs.
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    for (const siteId of [SEED.project.id]) {
      await page.goto(`/fr/dashboard/sites/${siteId}?tab=products`);
      await expect(page.locator('[data-compact]')).toBeVisible();
      expect(await flipsAtBottom(page), `oscillated at the bottom of ${siteId}`).toBe(0);
    }
  });

  test('still compacts and expands when you actually scroll', async ({ page }) => {
    // A bar that never changes would pass the test above and be useless.
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);
    const bar = page.locator('[data-compact]');

    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' as ScrollBehavior }));
    await expect(bar).toHaveAttribute('data-compact', 'true');

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
    await expect(bar).toHaveAttribute('data-compact', 'false');
  });
});
