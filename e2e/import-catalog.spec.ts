/**
 * CSV import, end to end: the hub, the wizard on a "my own store" project,
 * the single-product prefill, and the doors that must stay shut.
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

const MANUAL = SEED.manualProject.id;
const CONNECTED = SEED.project.id;

const CSV_TEXT =
  'Nom;Référence;Prix;Étiquettes;Description;Photos\n' +
  'Bougie en cire de soja, vanille;BG-1;19,90;bougie | vanille;<p>Nouvelle description</p>;https://cdn.example.com/bougie.jpg\n' +
  'Savon au lait d\'avoine;SV-1;6,50;savon;Doux pour la peau;https://cdn.example.com/savon.jpg\n' +
  ';SV-2;3;;;https://cdn.example.com/x.jpg\n';

const csvFile = (name = 'catalogue.csv', text = CSV_TEXT) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8')
});

async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    window.scrollTo(500, 0);
    const moved = window.scrollX > 0;
    window.scrollTo(0, 0);
    return moved;
  });
}

test.describe('CSV hub', () => {
  test('a manual store gets both panels live; a connected store gets an inert import', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${MANUAL}/csv`);
    await expect(page.getByTestId('csv-hub-import')).toHaveAttribute('href', /\/import$/);
    await expect(page.getByTestId('csv-hub-export')).toHaveAttribute('href', /\/export$/);

    await page.goto(`/fr/dashboard/sites/${CONNECTED}/csv`);
    await expect(page.getByTestId('csv-hub-import')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('csv-hub-import')).toContainText(/boutique connectée/i);
    await expect(page.getByTestId('csv-hub-export')).toHaveAttribute('href', /\/export$/);
  });

  test('the import page itself is not served for a connected store', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${CONNECTED}/import`);
    // notFound() inside a streamed dashboard layout renders the not-found
    // page after the shell has been flushed, so the HTTP status is not the
    // signal; the absence of the wizard is. The API routes' 404 is asserted
    // in tests/db/import-catalog.test.ts.
    await expect(page.getByTestId('import-file')).toHaveCount(0);
    await expect(page.getByTestId('import-next-mapping')).toHaveCount(0);
    await expect(page.getByText(/404|introuvable|not found/i).first()).toBeVisible();
  });
});

test.describe('import wizard', () => {
  test('file → columns → check → confirm, then the products are there', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${MANUAL}/import`);

    await page.getByTestId('import-file').setInputFiles(csvFile());
    // Semicolon detected, three data rows, six columns.
    await expect(page.getByTestId('import-detected')).toHaveText(/3 lignes, 6 colonnes/);
    await page.getByTestId('import-next-mapping').click();

    // French headers mapped themselves; the first column reads "Nom".
    await expect(page.getByTestId('import-map-0')).toContainText('Nom');
    await expect(page.getByTestId('import-map-5')).toContainText('Liens des images');
    await page.getByTestId('import-next-preview').click();

    // Row 1 matches the seeded product by SKU → update; row 2 is new; row 3
    // has no name → rejected.
    await expect(page.getByTestId('import-count-update')).toContainText('1');
    await expect(page.getByTestId('import-count-create')).toContainText('1');
    await expect(page.getByTestId('import-count-reject')).toContainText('1');
    await expect(page.getByTestId('import-rows')).toContainText(/nom manquant/i);

    await page.getByTestId('import-commit').click();
    await expect(page.getByTestId('import-done')).toBeVisible();
    await expect(page.getByTestId('import-done')).toContainText(/1 produits créés, 1 mis à jour/);

    await page.goto(`/fr/dashboard/sites/${MANUAL}?tab=products`);
    await expect(page.getByText("Savon au lait d'avoine").first()).toBeVisible();
  });

  test('a header-only file cannot go past the first step', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${MANUAL}/import`);
    await page.getByTestId('import-file').setInputFiles(csvFile('vide.csv', 'Nom;Prix\n'));
    await expect(page.getByText(/rien à importer/i)).toBeVisible();
    await expect(page.getByTestId('import-next-mapping')).toBeDisabled();
  });

  test('holds together on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/fr/dashboard/sites/${MANUAL}/csv`);
    expect(await pageScrollsSideways(page)).toBe(false);
    await page.goto(`/fr/dashboard/sites/${MANUAL}/import`);
    await page.getByTestId('import-file').setInputFiles(csvFile());
    await page.getByTestId('import-next-mapping').click();
    await expect(page.getByTestId('import-map-0')).toBeVisible();
    expect(await pageScrollsSideways(page)).toBe(false);
  });
});

test.describe('single product prefill', () => {
  test('the first valid row fills the creation form', async ({ page }) => {
    await login(page);
    await page.goto(`/fr/dashboard/sites/${MANUAL}/products/new`);
    await page.getByTestId('prefill-file').setInputFiles(csvFile());
    await expect(page.getByTestId('prefill-note')).toContainText(/ligne 1/i);
    await expect(page.locator('input[name="title"]')).toHaveValue('Bougie en cire de soja, vanille');
    await expect(page.locator('input[name="priceMin"]')).toHaveValue('19.9');
    await expect(page.locator('input[name="tags"]')).toHaveValue('bougie, vanille');
  });
});
