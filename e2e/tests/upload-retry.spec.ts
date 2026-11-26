import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, ADMIN, adminApi, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

const UPLOAD = /\/api\/photos\/upload$/;
const CHECK = /\/api\/photos\/admin\/check-duplicates$/;

async function openGallery(page: Page, title: string) {
  const gallery = await adminApi(page.request).createGallery({ title, slug: uniqueSlug('retry'), is_public: true });
  await page.goto(`${ADMIN}/galleries/${gallery.id}/photos`);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  return gallery;
}

const countCards = async (page: Page, galleryId: string) => {
  const res = await page.request.get(`${ADMIN}/api/photos/admin/all?gallery=${galleryId}`, {
    headers: { Origin: ADMIN },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()).data as unknown[]).length;
};

test('a photo the server stored before Cloudflare timed out (524) is reported uploaded, not sent twice', async ({ page }) => {
  const gallery = await openGallery(page, 'Lost answer');

  // The first upload reaches the server, which stores the photo; the browser
  // then gets Cloudflare's timeout page instead of the 201.
  let uploads = 0;
  let checks = 0;
  page.on('request', (r) => {
    if (CHECK.test(r.url())) checks += 1;
  });
  await page.route(UPLOAD, async (route) => {
    uploads += 1;
    if (uploads > 1) return route.continue();
    const stored = await route.fetch();
    expect(stored.status()).toBe(201);
    await route.fulfill({ status: 524, contentType: 'text/html', body: '<html>A timeout occurred</html>' });
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'lost-answer.jpg',
    mimeType: 'image/jpeg',
    buffer: uniqueJpeg('lost-answer'),
  });

  await expect(page.getByText(/Retrying in \d+s \(attempt 2\)/)).toBeVisible();
  await expect(page.getByText('Done · 1 uploaded')).toBeVisible({ timeout: 15_000 });
  // The list reloads, since there is no photo object to add.
  await expect(page.locator('[class*="card"]', { hasText: 'lost-answer.jpg' })).toBeVisible();

  expect(uploads).toBe(1);
  // The batch check, then the check before the retry found it.
  expect(checks).toBe(2);
  expect(await countCards(page, gallery.id)).toBe(1);
});

test('an upload whose connection drops is sent again by itself', async ({ page }) => {
  const gallery = await openGallery(page, 'Dropped connection');

  let uploads = 0;
  await page.route(UPLOAD, async (route) => {
    uploads += 1;
    if (uploads === 1) return route.abort('connectionreset');
    return route.continue();
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'dropped.jpg',
    mimeType: 'image/jpeg',
    buffer: uniqueJpeg('dropped'),
  });

  await expect(page.getByText(/Retrying in \d+s \(attempt 2\)/)).toBeVisible();
  await expect(page.locator('[class*="card"]', { hasText: 'dropped.jpg' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Done · 1 uploaded')).toBeVisible();
  expect(uploads).toBe(2);
  expect(await countCards(page, gallery.id)).toBe(1);
});
