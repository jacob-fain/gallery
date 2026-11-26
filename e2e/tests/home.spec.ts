import { expect, test } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, WIDE_FIXTURE, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('the homepage shows each public gallery whole under the hero, linking to it', async ({ page, browser }) => {
  const slug = uniqueSlug('home');
  const emptySlug = uniqueSlug('home-empty');
  const api = adminApi(page.request);
  const gallery = await api.createGallery({ title: 'Home smoke', slug, is_public: true });
  await api.createGallery({ title: 'Home empty', slug: emptySlug, is_public: true });
  const photo = await api.upload(gallery.id, 'home-smoke.jpg', uniqueJpeg('home', WIDE_FIXTURE));
  await api.setStatus(photo.id, 'shown');

  const visitor = await browser.newPage();
  await visitor.goto(PUBLIC);
  const door = visitor.getByRole('region', { name: 'Galleries' }).locator(`a[href="/g/${slug}"]`);
  await expect(door).toContainText('Home smoke');
  await expect(door).toContainText('1 photo');
  // A gallery with no photos is left off the homepage but stays on the Galleries page.
  await expect(visitor.locator(`a[href="/g/${emptySlug}"]`)).toHaveCount(0);

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

test('the homepage keeps its other sections when the gallery list fails, and retries it in place', async ({ page, browser }) => {
  const slug = uniqueSlug('home-retry');
  const api = adminApi(page.request);
  const gallery = await api.createGallery({ title: 'Home retry', slug, is_public: true });
  const photo = await api.upload(gallery.id, 'home-retry.jpg', uniqueJpeg('home-retry', WIDE_FIXTURE));
  await api.setStatus(photo.id, 'shown');

  const visitor = await browser.newPage();
  let fail = true;
  await visitor.route('**/api/galleries', (route) => (fail ? route.fulfill({ status: 503, body: '' }) : route.continue()));
  await visitor.goto(PUBLIC);

  const section = visitor.getByRole('region', { name: 'Galleries' });
  await expect(section.getByText("Couldn't load galleries.")).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 1, name: 'Jacob Fain' })).toBeVisible();
  await expect(visitor.getByRole('link', { name: /View all photos/ })).toBeVisible();

  fail = false;
  await section.getByRole('button', { name: 'Retry' }).click();
  await expect(section.getByText("Couldn't load galleries.")).toHaveCount(0);
  await expect(section.locator(`a[href="/g/${slug}"]`)).toBeVisible();
  await visitor.close();
});
