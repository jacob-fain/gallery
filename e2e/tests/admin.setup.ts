import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, PUBLIC, signIn } from './support';

// The session made here is shared by every test that needs one (the login
// route allows 10 attempts per address in 15 minutes), and admin.teardown.ts
// ends it once they have all run.
test('the admin signs in with an httpOnly session cookie', async ({ page, context }) => {
  await signIn(page);

  const session = (await context.cookies(`${ADMIN}/api/auth/me`)).find((c) => c.name === 'admin_session');
  expect(session).toMatchObject({
    domain: 'manage.gallery.localhost',
    path: '/api',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  });
  // Host-only and unreadable from script: the public site never receives it.
  expect(await context.cookies(`${PUBLIC}/api/galleries`)).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain('admin_session');

  // The cookie alone carries the session across a full reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

  await context.storageState({ path: ADMIN_STATE });
});
