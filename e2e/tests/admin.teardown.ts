import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE } from './support';

test.use({ storageState: ADMIN_STATE });

// Runs after every test that shares the session, since signing out revokes
// all of the admin's sessions.
test('the admin signs out and the session stops working', async ({ page, context, playwright }) => {
  await page.goto(ADMIN);
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

  expect((await context.cookies(`${ADMIN}/api/auth/me`)).map((c) => c.name)).not.toContain('admin_session');
  await page.goto(ADMIN);
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

  // A copy of the cookie kept from before is refused too: sign-out revokes
  // the token server side, not only in this browser.
  const kept = await playwright.request.newContext({ storageState: ADMIN_STATE, ignoreHTTPSErrors: true });
  expect((await kept.get(`${ADMIN}/api/auth/me`)).status()).toBe(401);
  await kept.dispose();
});
