import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_STATE, PUBLIC, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

const saved = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/photos\/status$/.test(r.url()));

test('an upload is reviewed in the viewer: shown, rejected, back to review and undone, then deleted with the rejected', async ({
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

  // The gallery had nothing to review when the page opened, so it lists All.
  // In the viewer, Show on site publishes it; under All it stays, the only
  // photo, with Shown pressed in the place Show on site was.
  await tile.click();
  const viewer = page.locator('.yarl__root');
  const toast = page.getByRole('status').filter({ hasText: 'Undo' });
  await expect(viewer.getByText('Review smoke · 1 / 1 · Needs review')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Needs review' })).toHaveAttribute('aria-pressed', 'true');
  let response = saved(page);
  await viewer.getByRole('button', { name: 'Show on site' }).click();
  expect((await response).ok()).toBe(true);
  await expect(viewer.getByText('Review smoke · 1 / 1 · Shown')).toBeVisible();
  await expect(viewer.getByText('That was the last photo in this list.')).toBeVisible();
  await expect(toast).toHaveText('Shown on site · Undo');
  await expect(viewer.getByRole('button', { name: 'Shown' })).toBeDisabled();
  await visitorSees(1);
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);

  // Under Shown, Reject makes it private again. It leaves the filter, and as
  // the only photo there the viewer closes with All done and an undo.
  await status.getByRole('button', { name: 'Shown · 1' }).click();
  await tile.click();
  await expect(viewer.getByText('Review smoke · 1 / 1 · Shown')).toBeVisible();
  response = saved(page);
  await viewer.getByRole('button', { name: 'Reject' }).click();
  expect((await response).ok()).toBe(true);
  await expect(viewer).toHaveCount(0);
  await expect(toast).toHaveText('All done. Rejected · Undo');
  await expect(page.getByText('No photos are shown on the site.')).toBeVisible();
  await visitorSees(0);

  // Under Rejected, Back to review, then Undo puts it back as rejected for
  // the delete below.
  await status.getByRole('button', { name: 'Rejected · 1' }).click();
  await tile.click();
  response = saved(page);
  await viewer.getByRole('button', { name: 'Back to review' }).click();
  expect((await response).ok()).toBe(true);
  await expect(toast).toHaveText('All done. Moved to review · Undo');
  await expect(status.getByRole('button', { name: 'Needs review · 1' })).toBeVisible();
  response = saved(page);
  await toast.getByRole('button', { name: 'Undo' }).click();
  expect((await response).ok()).toBe(true);
  await expect(tile).toHaveCount(1);
  await expect(status.getByRole('button', { name: 'Rejected · 1' })).toBeVisible();

  // Delete all rejected removes it, after a confirm.
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
