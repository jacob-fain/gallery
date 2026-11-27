import { expect, test } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('a shared photo link opens that photo, Back closes it, and the photo counts once', async ({ page, browser }) => {
  const api = adminApi(page.request);
  const slug = uniqueSlug('link');
  const gallery = await api.createGallery({ title: 'Link smoke', slug, is_public: true });
  for (const name of ['first.jpg', 'second.jpg']) {
    const photo = await api.upload(gallery.id, name, uniqueJpeg(name));
    await api.setStatus(photo.id, 'shown');
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
  // A visit deals its own order, so a photo's place is read from its tile.
  const placeOf = async (id: string) =>
    (await visitor.locator(`img[data-photo="${id}"]`).getAttribute('alt'))!.match(/Photo (\d) of 2/)![1];

  await visitor.goto(`${PUBLIC}/g/${slug}?photo=${second}`);
  await expect(lightbox).toBeVisible();
  const label = lightbox.getByText(/^Link smoke · [12] \/ 2$/);
  await expect(label).toBeVisible();
  const linkedLabel = await label.textContent();
  await expectImagesLoaded(visitor, '.yarl__slide_current img');
  expect(search()).toBe(`?photo=${second}`);

  // Back closes the photo and stays in the gallery.
  await visitor.goBack();
  await expect(lightbox).toHaveCount(0);
  expect(new URL(visitor.url()).pathname).toBe(`/g/${slug}`);
  expect(search()).toBe('');
  await expectImagesLoaded(visitor, `img[data-photo="${second}"]`);
  // The viewer opened the linked photo at its place in this visit's order.
  expect(linkedLabel).toBe(`Link smoke · ${await placeOf(second)} / 2`);

  // Opening and moving between photos keeps the URL on the photo shown.
  await visitor.locator(`img[data-photo="${first}"]`).click();
  await expect(lightbox).toBeVisible();
  await expect.poll(search).toBe(`?photo=${first}`);
  await visitor.keyboard.press('ArrowRight');
  await expect.poll(search).toBe(`?photo=${second}`);

  // A reload of the photo's entry shows the photo again, and Back still closes it.
  await visitor.reload();
  await expect(lightbox.getByText(linkedLabel!)).toBeVisible();
  await visitor.goBack();
  await expect(lightbox).toHaveCount(0);
  expect(search()).toBe('');

  // One view of each photo per page view: the link's, then the reload's.
  await expect.poll(() => views.length).toBe(3);
  expect(views).toEqual([second, first, second]);
  await visitor.close();
});
