import { expect, test } from '@playwright/test';

test('unknown pages and galleries show a not-found page that is kept out of search', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/g/no-such-gallery');
  await expect(page.getByRole('heading', { name: 'Gallery not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all galleries' })).toBeVisible();
});
