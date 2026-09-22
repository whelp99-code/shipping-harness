import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  test.skip(!process.env.CORE5_UI_BASE_URL, 'CORE5_UI_BASE_URL is required for Linux browser acceptance');
});

test('human operator can inspect evidence before approval', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /approval|review/i })).toBeVisible();
  await expect(page.getByText(/evidence|reason/i)).toBeVisible();
});

test('human operator can reject and cancel a stale operation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /reject|cancel/i }).click();
  await expect(page.getByText(/cancelled|rejected/i)).toBeVisible();
});
