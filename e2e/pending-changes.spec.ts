import { expect, test, type Page } from '@playwright/test';
import mysql from 'mysql2/promise';
import { E2E_ENV } from '../playwright.config';
import { SEED } from './seed';

/**
 * Put the three seeded changes back: two waiting, one the store refused.
 *
 * The "apply a selection" test re-sends the refused one, which supersedes it —
 * correctly, and the banner then has nothing left to report and disappears.
 * Every other test in this file needs the refusal to exist, so the fixture is
 * restored rather than inherited.
 */
async function resetChanges() {
  const conn = await mysql.createConnection({ uri: E2E_ENV.DATABASE_URL });
  try {
    const [users] = await conn.execute('SELECT id FROM users WHERE email = ?', [SEED.user.email]);
    const userId = (users as Array<{ id: string }>)[0].id;
    await conn.execute('DELETE FROM product_changes WHERE product_id = ?', [
      SEED.pendingProduct.id
    ]);
    const row = (id: string, field: string, value: unknown, prior: unknown) => [
      id,
      SEED.pendingProject.id,
      SEED.pendingProduct.id,
      SEED.pendingProduct.sourceId,
      field,
      JSON.stringify(value),
      JSON.stringify(prior)
    ];
    for (const r of [
      row(SEED.pendingChanges.title, 'title', 'Hand-thrown stoneware mug', 'Waiting stoneware mug'),
      row(
        SEED.pendingChanges.description,
        'description',
        '<p>A new description.</p>',
        '<p>An old description.</p>'
      )
    ]) {
      await conn.execute(
        `INSERT INTO product_changes
           (id, project_id, product_id, product_source_id, field, value, value_hash,
            prior_value_hash, prior_value, status, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, 'seed-hash', 'seed-prior-hash', ?, 'pending', ?)`,
        [...r, userId]
      );
    }
    await conn.execute(
      `INSERT INTO product_changes
         (id, project_id, product_id, product_source_id, field, value, value_hash,
          prior_value_hash, prior_value, status, source_job_id, acked_at, ack_payload,
          approved_by)
       VALUES (?, ?, ?, ?, 'tags', ?, 'seed-hash', 'seed-prior-hash', ?, 'failed', ?, NOW(), ?, ?)`,
      [
        SEED.pendingChanges.failedTags,
        SEED.pendingProject.id,
        SEED.pendingProduct.id,
        SEED.pendingProduct.sourceId,
        JSON.stringify(['stoneware', 'handmade']),
        JSON.stringify(['mug']),
        SEED.pendingChanges.failedJobId,
        JSON.stringify({ status: 'failed', error: 'HTTP 500' }),
        userId
      ]
    );
  } finally {
    await conn.end();
  }
}

const PRODUCT_URL = `/fr/dashboard/sites/${SEED.pendingProject.id}/products/${SEED.pendingProduct.id}`;

async function login(page: Page) {
  await page.goto('/fr/login');
  await page.fill('input[name="email"]', SEED.user.email);
  await page.fill('input[name="password"]', SEED.user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/fr\/dashboard/);
}

test.describe('changes waiting for the store', () => {
  test.beforeEach(async ({ page }) => {
    await resetChanges();
    await login(page);
  });

  test('the dashboard card carries the count and links to the integrations tab', async ({
    page
  }) => {
    await page.goto('/fr/dashboard');
    const pill = page.getByTestId('pending-changes-pill').filter({ visible: true }).first();
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-count', '3');
    expect(await pill.getAttribute('href')).toContain(
      `/dashboard/sites/${SEED.pendingProject.id}?tab=integrations`
    );
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
  });

  test('the product banner opens the recap, applies a selection and reports it', async ({
    page
  }) => {
    await page.goto(PRODUCT_URL);
    const banner = page.getByTestId('pending-changes-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-count', '3');
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
    // Nothing opens by itself.
    await expect(page.getByTestId('pending-changes-modal')).toHaveCount(0);

    // Opened by the button, focus lands inside the dialog, Escape closes it.
    await page.getByTestId('pending-changes-open').click();
    await expect(page.getByTestId('pending-changes-modal')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          // Scoped: the cookie notice is a dialog too, and it comes first.
          const dialog = document
            .querySelector('[data-testid="pending-changes-modal"]')
            ?.closest('[role="dialog"]');
          return !!dialog && dialog.contains(document.activeElement);
        })
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pending-changes-modal')).toHaveCount(0);

    await page.getByTestId('pending-changes-open').click();
    const modal = page.getByTestId('pending-changes-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('pending-change-row')).toHaveCount(3);
    await expect(modal.locator('[data-status="failed"]')).toHaveCount(1);
    await expect(modal.locator('[data-status="pending"]')).toHaveCount(2);

    // Everything is selected by default; drop one waiting change.
    await expect(page.getByTestId('pending-selection-count')).toContainText('3 sur 3');
    await modal.locator('[data-status="pending"]').first().locator('input[type="checkbox"]').uncheck();
    await expect(page.getByTestId('pending-selection-count')).toContainText('2 sur 3');

    await page.getByTestId('pending-apply-selection').click();
    const result = page.getByTestId('pending-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('2');

    // The refused change was sent again, so nothing is refused any more — and
    // the banner exists precisely to report refusals. It goes, and takes its
    // modal with it: the merchant is told what happened by the result line
    // above, not by a panel that now has nothing to say.
    await expect(banner).toHaveCount(0);
    await expect(modal).toHaveCount(0);
  });

  test('the banner hint opens from the keyboard and is announced, Escape closes it', async ({
    page
  }) => {
    await page.goto(PRODUCT_URL);
    const banner = page.getByTestId('pending-changes-banner');
    await expect(banner).toBeVisible();

    const hint = banner.getByTestId('info-hint');
    await expect(hint).toHaveAttribute('data-topic', 'pendingSync');
    await expect(hint).toHaveAccessibleName(/Pourquoi c’est important/);
    await expect(page.getByTestId('info-hint-panel')).toHaveCount(0);

    // Focus alone opens it — no mouse, no tap.
    await hint.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await expect(hint).toHaveAccessibleDescription(/pas encore sur votre boutique/);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('info-hint-panel')).toHaveCount(0);
    await expect(hint).toBeFocused();
    await expect(page.locator('body')).not.toContainText(/MISSING_MESSAGE|Application error/);
  });
});
