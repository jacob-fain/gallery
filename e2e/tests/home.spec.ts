import { expect, test } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, WIDE_FIXTURE, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('the homepage shows each public gallery whole under the hero, linking to it', async ({ page, browser }) => {
  const slug = uniqueSlug('home');
  const api = adminApi(page.request);
  const gallery = await api.createGallery({ title: 'Home smoke', slug, is_public: true });
  const photo = await api.upload(gallery.id, 'home-smoke.jpg', uniqueJpeg('home', WIDE_FIXTURE));
  await api.setStatus(photo.id, 'shown');

  const visitor = await browser.newPage();
  await visitor.goto(PUBLIC);
  const door = visitor.getByRole('region', { name: 'Galleries' }).locator(`a[href="/g/${slug}"]`);
  await expect(door).toContainText('Home smoke');
  await expect(door).toContainText('1 photo');

  // The cover keeps the photo's own proportions instead of a cropped box.
  await expectImagesLoaded(visitor, `a[href="/g/${slug}"] img`);
  const { box, natural } = await door.locator('img').evaluate((img: HTMLImageElement) => ({
    box: img.getBoundingClientRect().width / img.getBoundingClientRect().height,
    natural: img.naturalWidth / img.naturalHeight,
  }));
  expect(box).toBeCloseTo(natural, 1);

  await expect(visitor.getByRole('link', { name: /View all photos/ })).toHaveAttribute('href', '/photos');
  await door.click();
  await expect(visitor).toHaveURL(`${PUBLIC}/g/${slug}`);
  await visitor.close();
});
