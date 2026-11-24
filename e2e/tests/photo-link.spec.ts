import { expect, test } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('a shared photo link opens that photo, Back closes it, and the photo counts once', async ({ page, browser }) => {
  const api = adminApi(page.request);
  const slug = uniqueSlug('link');
  const gallery = await api.createGallery({ title: 'Link smoke', slug, is_public: true });
  for (const name of ['first.jpg', 'second.jpg']) {
    const photo = await api.upload(gallery.id, name, uniqueJpeg(name));
    await api.setHidden(photo.id, false);
  }

  const visitor = await browser.newPage();
  const listed = await visitor.request.get(`${PUBLIC}/api/galleries/${slug}/photos`);
  const [first, second] = ((await listed.json()).data as { id: string }[]).map((p) => p.id);
  const views: string[] = [];
  visitor.on('request', (request) => {
    const match = request.method() === 'POST' && request.url().match(/\/api\/photos\/([^/]+)\/view$/);
    if (match) views.push(match[1]);
  });

  const lightbox = visitor.locator('.yarl__root');
  const search = () => new URL(visitor.url()).search;

  await visitor.goto(`${PUBLIC}/g/${slug}?photo=${second}`);
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByText('2 / 2')).toBeVisible();
  await expectImagesLoaded(visitor, '.yarl__slide_current img');
  expect(search()).toBe(`?photo=${second}`);

  // Back closes the photo and stays in the gallery.
  await visitor.goBack();
  await expect(lightbox).toHaveCount(0);
  expect(new URL(visitor.url()).pathname).toBe(`/g/${slug}`);
  expect(search()).toBe('');
  await expectImagesLoaded(visitor, 'img[alt="Photo 2 of 2 in Link smoke"]');

  // Opening and moving between photos keeps the URL on the photo shown.
  await visitor.getByAltText('Photo 1 of 2 in Link smoke').click();
  await expect(lightbox).toBeVisible();
  await expect.poll(search).toBe(`?photo=${first}`);
  await visitor.keyboard.press('ArrowRight');
  await expect.poll(search).toBe(`?photo=${second}`);

  // A reload of the photo's entry shows the photo again, and Back still closes it.
  await visitor.reload();
  await expect(lightbox.getByText('2 / 2')).toBeVisible();
  await visitor.goBack();
  await expect(lightbox).toHaveCount(0);
  expect(search()).toBe('');

  // One view of each photo per page view: the link's, then the reload's.
  await expect.poll(() => views.length).toBe(3);
  expect(views).toEqual([second, first, second]);
  await visitor.close();
});
