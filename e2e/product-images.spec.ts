import { expect, test, type Page } from '@playwright/test';
import mysql from 'mysql2/promise';
import { E2E_ENV } from '../playwright.config';
import { SEED } from './seed';

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

/** The change the editor queued, read straight from the database. */
async function imageChanges(productId: string) {
  const conn = await mysql.createConnection({ uri: E2E_ENV.DATABASE_URL });
  try {
    const [rows] = await conn.execute(
      'SELECT field, status, value FROM product_changes WHERE product_id = ?',
      [productId]
    );
    return rows as Array<{ field: string; status: string; value: unknown }>;
  } finally {
    await conn.end();
  }
}

const editorUrl = `/fr/dashboard/sites/${SEED.imageProject.id}/products/${SEED.imageProduct.id}`;

test.describe('product images', () => {
  test.beforeEach(async ({ page }) => login(page));

  test('queues two actions, previews them, and applies them as one change', async ({ page }) => {
    await page.goto(editorUrl);
    const editor = page.getByTestId('image-editor');
    await expect(editor).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    await expect(page.getByTestId('image-editor-fallback')).toHaveCount(0);

    const tiles = editor.getByTestId('editor-tile');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveAttribute('data-ref', 'm1');
    await expect(tiles.nth(0)).toHaveAttribute('data-main', 'true');
    await expect(tiles.nth(0)).toContainText('Sur votre boutique');

    // "Définir comme principale" on photo 3 → the preview reorders itself.
    await editor.locator('[data-ref="m3"]').getByTestId('tile-set-featured').click();
    await expect(tiles.nth(0)).toHaveAttribute('data-ref', 'm3');
    await expect(tiles.nth(0)).toHaveAttribute('data-main', 'true');

    // "Retirer du produit" on photo 1 → the tile leaves the previewed gallery.
    await editor.locator('[data-ref="m1"]').getByTestId('tile-remove').click();
    await expect(tiles).toHaveCount(2);

    const queue = page.getByTestId('pending-ops');
    await expect(queue).toHaveAttribute('data-count', '2');
    await expect(queue.getByTestId('queued-op')).toHaveCount(2);
    await expect(queue).toContainText('Définir Photo 3 comme photo principale');
    await expect(queue).toContainText('Retirer Photo 1 du produit');

    await page.getByTestId('apply-image-ops').click();
    await expect(editor.getByRole('status')).toContainText('C’est enregistré', { timeout: 20_000 });

    const changes = await imageChanges(SEED.imageProduct.id);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('images');
    expect(changes[0].status).toBe('pending');
    const value =
      typeof changes[0].value === 'string' ? JSON.parse(changes[0].value) : changes[0].value;
    expect(value).toEqual({
      v: 1,
      ops: [
        { op: 'set_featured', target: 'm3' },
        { op: 'remove', target: 'm1' }
      ]
    });

    // The queue is empty again and nothing else was queued behind our back.
    await expect(page.getByTestId('pending-ops')).toHaveAttribute('data-count', '0');
  });

  test('the move buttons reorder the gallery without a mouse drag', async ({ page }) => {
    await page.goto(editorUrl);
    const editor = page.getByTestId('image-editor');
    const tiles = editor.getByTestId('editor-tile');
    await expect(tiles).toHaveCount(3);

    await editor.locator('[data-ref="m2"]').getByTestId('tile-move-left').click();
    await expect(tiles.nth(0)).toHaveAttribute('data-ref', 'm2');
    await expect(tiles.nth(1)).toHaveAttribute('data-ref', 'm1');

    const queue = page.getByTestId('pending-ops');
    await expect(queue).toContainText('ordre');
    // The first photo cannot move further left.
    await expect(editor.locator('[data-ref="m2"]').getByTestId('tile-move-left')).toBeDisabled();

    // Taking the decision back restores the store's own order.
    await queue.getByTestId('queued-op').getByRole('button').first().click();
    await expect(tiles.nth(0)).toHaveAttribute('data-ref', 'm1');
    await expect(page.getByTestId('apply-image-ops')).toBeDisabled();
  });

  test('a store without stable image ids keeps the replace-all path only', async ({ page }) => {
    await page.goto(`/fr/dashboard/sites/${SEED.project.id}?tab=products`);
    const productLink = page
      .getByRole('link', { name: /Hand-thrown stoneware coffee mug/ })
      .filter({ visible: true })
      .first();
    await page.goto((await productLink.getAttribute('href'))!);
    await page.waitForURL(/\/products\//);

    const editor = page.getByTestId('image-editor');
    await expect(editor).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    const fallback = page.getByTestId('image-editor-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText('Mettez à jour l’extension OneShopLab');
    // No per-photo action, and nothing to queue.
    await expect(editor.getByTestId('tile-set-featured')).toHaveCount(0);
    await expect(editor.getByTestId('tile-remove')).toHaveCount(0);
    await expect(editor.getByTestId('tile-alt')).toHaveCount(0);
    await expect(page.getByTestId('pending-ops')).toHaveCount(0);
  });
});
