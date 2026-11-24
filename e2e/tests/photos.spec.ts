import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADMIN_STATE, ADMIN, PUBLIC, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('an upload lands hidden in the photo manager and Show publishes it', async ({ page, browser }) => {
  const slug = uniqueSlug('upload');
  const gallery = await adminApi(page.request).createGallery({ title: 'Upload smoke', slug, is_public: true });

  await page.goto(`${ADMIN}/galleries/${gallery.id}/photos`);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'upload-smoke.jpg',
    mimeType: 'image/jpeg',
    buffer: uniqueJpeg('upload'),
  });

  const card = page.locator('[class*="card"]', { hasText: 'upload-smoke.jpg' });
  await expect(card.getByText('Hidden', { exact: true })).toBeVisible({ timeout: 30_000 });
  // The thumbnail comes from S3 through a signed URL.
  await expectImagesLoaded(page, '[class*="card"]:has-text("upload-smoke.jpg") img');

  // A visitor sees nothing while the photo is hidden.
  const visitor = await browser.newPage();
  await visitor.goto(`${PUBLIC}/g/${slug}`);
  await expect(visitor.getByText('No photos in this gallery yet.')).toBeVisible();

  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/photos\/[^/]+$/.test(r.url()));
  await card.getByTitle('Show photo').click();
  expect((await saved).ok()).toBe(true);
  await expect(card.getByText('Hidden', { exact: true })).toHaveCount(0);

  await visitor.reload();
  await expectImagesLoaded(visitor, 'img[alt="Photo 1 of 1 in Upload smoke"]');
  await visitor.close();
});

test('the lightbox opens a photo and downloads the original under its filename', async ({ page, browser }) => {
  const api = adminApi(page.request);
  const slug = uniqueSlug('lightbox');
  const gallery = await api.createGallery({ title: 'Lightbox smoke', slug, is_public: true });
  const original = uniqueJpeg('lightbox');
  const photo = await api.upload(gallery.id, 'Lightbox Original.jpg', original);
  await api.setHidden(photo.id, false);

  const visitor = await browser.newPage();
  await visitor.goto(`${PUBLIC}/g/${slug}`);
  await visitor.getByAltText('Photo 1 of 1 in Lightbox smoke').click();

  const lightbox = visitor.locator('.yarl__root');
  await expect(lightbox).toBeVisible();
  await expectImagesLoaded(visitor, '.yarl__slide_current img');

  const downloading = visitor.waitForEvent('download');
  await lightbox.getByRole('button', { name: 'Download' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Lightbox Original.jpg');
  // Byte for byte what was uploaded: the original is stored unprocessed.
  expect(readFileSync(await download.path()).equals(original)).toBe(true);

  await visitor.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await visitor.close();
});
