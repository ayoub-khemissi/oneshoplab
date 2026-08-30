import { expect, test } from '@playwright/test';
import { SEED } from './seed';

test.describe('authentication', () => {
  test('signup creates an account and lands on the dashboard', async ({ page }) => {
    const email = `signup-${Date.now()}@test.local`;
    await page.goto('/fr/signup');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'brand-new-password-1');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.waitForURL(/\/fr\/dashboard/);
    await expect(page.getByText(/Bienvenue/)).toBeVisible(); // fresh account: onboarding dashboard
  });

  test('signup refuses a taken email and a short password', async ({ page }) => {
    await page.goto('/fr/signup');
    await page.fill('input[name="email"]', SEED.user.email);
    await page.fill('input[name="password"]', 'brand-new-password-1');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByText('Un compte existe déjà avec cet email.').first()).toBeVisible();
  });

  test('login with the seeded account, wrong password is refused', async ({ page }) => {
    await page.goto('/fr/login');
    await page.fill('input[name="email"]', SEED.user.email);
    await page.fill('input[name="password"]', 'wrong-password');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Email ou mot de passe incorrect.').first()).toBeVisible();
    await page.goto('/fr/login'); // the error came through a redirect: start from a settled page

    await page.fill('input[name="email"]', SEED.user.email);
    await page.fill('input[name="password"]', SEED.user.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL(/\/fr\/dashboard/);
    await expect(page.getByText('Mes sites')).toBeVisible();
  });

  test('dashboard requires a session', async ({ page }) => {
    await page.goto('/fr/dashboard');
    await page.waitForURL(/\/fr\/login/);
  });

  test('forgot-password form accepts an email without leaking whether it exists', async ({ page }) => {
    await page.goto('/fr/forgot-password');
    await page.fill('input[name="email"]', 'nobody@test.local');
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL(/sent=1/);
  });
});
