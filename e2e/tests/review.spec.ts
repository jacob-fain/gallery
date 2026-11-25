import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_STATE, PUBLIC, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

const saved = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/photos\/status$/.test(r.url()));

test('an upload is reviewed in the viewer: shown, rejected, back to review, then deleted with the rejected', async ({
  page,
  browser,
}) => {
  const slug = uniqueSlug('review');
  const gallery = await adminApi(page.request).createGallery({ title: 'Review smoke', slug, is_public: true });
  const visitor = await browser.newPage();
  // Reloaded after the first visit, as photos.spec does: the public answers
  // are cacheable for a minute, and a reload asks again.
  let visited = false;
  const visitorSees = async (photos: number) => {
    if (visited) await visitor.reload();
    else await visitor.goto(`${PUBLIC}/g/${slug}`);
    visited = true;
    if (photos === 0) await expect(visitor.getByText('No photos in this gallery yet.')).toBeVisible();
    else await expectImagesLoaded(visitor, `img[alt="Photo 1 of ${photos} in Review smoke"]`);
  };

  await page.goto(`${ADMIN}/galleries/${gallery.id}/photos`);
  // Review is the default view.
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'review-smoke.jpg',
    mimeType: 'image/jpeg',
    buffer: uniqueJpeg('review'),
  });

  // The upload lands in Needs review, private.
  const status = page.getByRole('group', { name: 'Status' });
  await expect(status.getByRole('button', { name: 'Needs review · 1' })).toBeVisible({ timeout: 30_000 });
  const tile = page.locator('.react-photo-album--photo');
  await expect(tile.getByText('Needs review', { exact: true })).toBeVisible();
  await visitorSees(0);

  // In the viewer: Show on site publishes it. It is the only photo, so the
  // viewer stays and says so.
  await tile.click();
  const viewer = page.locator('.yarl__root');
  await expect(viewer.getByText('Review smoke · 1 / 1 · Needs review')).toBeVisible();
  let response = saved(page);
  await viewer.getByRole('button', { name: 'Show on site' }).click();
  expect((await response).ok()).toBe(true);
  await expect(viewer.getByText('Review smoke · 1 / 1 · Shown')).toBeVisible();
  await expect(viewer.getByText('That was the last photo in this list.')).toBeVisible();
  await visitorSees(1);

  // Reject makes it private again.
  response = saved(page);
  await viewer.getByRole('button', { name: 'Reject' }).click();
  expect((await response).ok()).toBe(true);
  await expect(viewer.getByText('Review smoke · 1 / 1 · Rejected')).toBeVisible();
  await visitorSees(0);

  // Back to review, and rejected once more for the delete below.
  response = saved(page);
  await viewer.getByRole('button', { name: 'Back to review' }).click();
  expect((await response).ok()).toBe(true);
  await expect(viewer.getByText('Review smoke · 1 / 1 · Needs review')).toBeVisible();
  response = saved(page);
  await viewer.getByRole('button', { name: 'Reject' }).click();
  expect((await response).ok()).toBe(true);
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);

  // Delete all rejected removes it, after a confirm.
  await status.getByRole('button', { name: 'Rejected · 1' }).click();
  await page.getByRole('button', { name: 'Delete all rejected (1)' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete 1' }).click();
  await expect(page.getByText('No rejected photos.')).toBeVisible();
  await expect(status.getByRole('button', { name: 'Rejected · 0' })).toBeVisible();

  const left = await page.request.get(`${ADMIN}/api/photos/admin/all?gallery=${gallery.id}`, {
    headers: { Origin: ADMIN },
  });
  expect((await left.json()).data).toEqual([]);
  await visitor.close();
});
