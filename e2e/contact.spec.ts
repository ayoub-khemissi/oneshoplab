import { expect, test } from '@playwright/test';

test('contact form stores the message and confirms', async ({ page }) => {
  await page.goto('/fr/contact');
  await page.fill('input[name="name"]', 'Visiteur E2E');
  await page.fill('input[name="email"]', 'visiteur@test.local');
  await page.fill('textarea[name="message"]', 'Bonjour, ceci est un message de test automatisé.');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.getByText('Message envoyé')).toBeVisible();
});
