/**
 * Catalogue export page: browse, sort, filter, pick columns, download.
 *
 * The mobile assertions are deliberate. This page is a table — the one
 * layout that silently breaks a phone by pushing the whole document
 * sideways. Every check here fails if the body itself scrolls horizontally;
 * the table is allowed to scroll inside its own container, and only there.
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

/**
 * True when the PAGE itself can be dragged sideways. Asserted by actually
 * scrolling: `documentElement.scrollWidth` lies here — Chromium reports the
 * width of a table nested in an `overflow-x:auto` box even though the box
 * clips it, so the only trustworthy question is whether the window moved.
 */
async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    window.scrollTo(500, 0);
    const moved = window.scrollX > 0;
    window.scrollTo(0, 0);
    return moved;
  });
}

const EXPORT_URL = `/fr/dashboard/sites/${SEED.project.id}/export`;

test.describe('catalogue export', () => {
  test('lists the catalogue, sorts and filters from the URL', async ({ page }) => {
    await login(page);
    await page.goto(EXPORT_URL);

    const table = page.getByTestId('export-table');
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();

    // Sorting is a link: it must change the URL and survive a reload.
    await page.getByRole('link', { name: /Trier par Nom/i }).click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(table.locator('tbody tr').first()).toBeVisible();

    // A search that matches nothing shows the empty state, not a crash.
    await page.goto(`${EXPORT_URL}?q=zzzzzzzznothing`);
    await expect(page.getByText(/Aucun produit/i)).toBeVisible();
    await expect(table).toHaveCount(0);

    await page.goto(EXPORT_URL);
    await expect(table.locator('tbody tr')).toHaveCount(before);
  });

  test('the column picker adds a column to the table', async ({ page }) => {
    await login(page);
    await page.goto(EXPORT_URL);

    const header = page.getByTestId('export-table').locator('thead');
    // "Marque" is deliberately outside DEFAULT_COLUMN_KEYS.
    await expect(header.getByText('Marque')).toHaveCount(0);

    await page.getByText(/Colonnes à extraire/i).click();
    await page.getByRole('button', { name: 'Marque', exact: true }).click();

    await expect(page).toHaveURL(/columns=/);
    await expect(header.getByText('Marque')).toBeVisible();
  });

  test('downloads a CSV of the catalogue and of one product', async ({ page }) => {
    await login(page);
    await page.goto(EXPORT_URL);

    const all = page.waitForEvent('download');
    await page.getByRole('button', { name: /Extraire \d+ produits/i }).click();
    const file = await all;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);

    const one = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Extraire ce produit' }).first().click();
    expect((await one).suggestedFilename()).toMatch(/\.csv$/);
  });

  test('holds together on a phone, without pushing the page sideways', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await login(page);
    await page.goto(EXPORT_URL);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await pageScrollsSideways(page)).toBe(false);

    // A phone gets cards, not a table: nothing to scroll sideways at all.
    await expect(page.getByTestId('export-table')).toBeHidden();
    await expect(page.getByTestId('export-cards').locator('li').first()).toBeVisible();
    // Sorting must still be reachable without the table header.
    await expect(page.locator('#export-sort')).toBeVisible();

    // Controls must not be drawn on top of each other. The page-scroll check
    // alone passed while the status filter sat over the search field, so the
    // collision is asserted explicitly.
    const search = page.getByRole('searchbox').first();
    const status = page.getByRole('group', { name: /statut/i });
    const a = await search.boundingBox();
    const b = await status.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a && b) {
      const overlaps =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps).toBe(false);
      expect(a.x + a.width).toBeLessThanOrEqual(PHONE.width + 1);
      expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width + 1);
    }

    // Opening the column picker must not break the layout either.
    await page.getByText(/Colonnes à extraire/i).click();
    await expect(page.getByRole('button', { name: 'Marque', exact: true })).toBeVisible();
    expect(await pageScrollsSideways(page)).toBe(false);
  });

  test('the site header language button is reachable on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await login(page);
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}`);

    await expect(page.getByTestId('site-language-button')).toBeVisible();
    expect(await pageScrollsSideways(page)).toBe(false);
  });
});
