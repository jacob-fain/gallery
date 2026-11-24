import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, adminApi, expectImagesLoaded, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('a private gallery unlocks with its password and stays unlocked on revisit', async ({ page, browser }) => {
  const api = adminApi(page.request);
  const slug = uniqueSlug('private');
  const gallery = await api.createGallery({ title: 'Private smoke', slug, is_public: false, password: 'open-sesame' });
  const photo = await api.upload(gallery.id, 'private.jpg', uniqueJpeg('private'));
  await api.setHidden(photo.id, false);

  const visitor = await browser.newPage();
  await visitor.goto(`${PUBLIC}/g/${slug}`);
  const password = visitor.getByPlaceholder('Enter password');
  const submit = visitor.getByRole('button', { name: 'View Gallery' });
  await expect(password).toBeVisible();
  // Nothing about the photos is served before the password.
  expect((await visitor.request.get(`${PUBLIC}/api/galleries/${slug}/photos`)).status()).toBe(403);

  await password.fill('wrong-password');
  await submit.click();
  await expect(visitor.getByText('Invalid password')).toBeVisible();

  await password.fill('open-sesame');
  await submit.click();
  await expectImagesLoaded(visitor, 'img[alt="Photo 1 of 1 in Private smoke"]');

  // Leaving and coming back in the same tab needs no password again.
  await visitor.goto(`${PUBLIC}/galleries`);
  await visitor.goto(`${PUBLIC}/g/${slug}`);
  await expectImagesLoaded(visitor, 'img[alt="Photo 1 of 1 in Private smoke"]');
  await expect(password).toHaveCount(0);
  await visitor.close();

  // A new visitor is asked again.
  const stranger = await browser.newPage();
  await stranger.goto(`${PUBLIC}/g/${slug}`);
  await expect(stranger.getByPlaceholder('Enter password')).toBeVisible();
  await stranger.close();
});

// nginx's error log records full request lines, so the access token must
// never be part of a URL: the API calls send it in a header, and the ZIP, a
// navigation, carries a one-time ticket instead.
test('an unlocked private gallery downloads without its access token in any URL', async ({ page, browser }) => {
  const api = adminApi(page.request);
  const slug = uniqueSlug('ticket');
  const gallery = await api.createGallery({ title: 'Ticket smoke', slug, is_public: false, password: 'open-sesame' });
  const original = uniqueJpeg('ticket');
  const photo = await api.upload(gallery.id, 'Ticket Original.jpg', original);
  await api.setHidden(photo.id, false);

  const visitor = await browser.newPage();
  const urls: string[] = [];
  visitor.on('request', (request) => urls.push(request.url()));
  await visitor.goto(`${PUBLIC}/g/${slug}`);
  await visitor.getByPlaceholder('Enter password').fill('open-sesame');
  await visitor.getByRole('button', { name: 'View Gallery' }).click();
  await expectImagesLoaded(visitor, 'img[alt="Photo 1 of 1 in Ticket smoke"]');
  const token = await visitor.evaluate((key) => sessionStorage.getItem(key), `gallery_access_${slug}`);
  expect(token).toBeTruthy();

  const zipping = visitor.waitForEvent('download');
  await visitor.getByRole('button', { name: 'Download all photos as ZIP' }).click();
  const zip = await zipping;
  expect(zip.suggestedFilename()).toBe(`${slug}.zip`);
  expect(readFileSync(await zip.path()).includes(original)).toBe(true);
  expect(new URL(zip.url()).searchParams.get('ticket')).toBeTruthy();
  // The ticket is spent by the download.
  expect((await visitor.request.get(zip.url())).status()).toBe(403);

  await visitor.getByAltText('Photo 1 of 1 in Ticket smoke').click();
  const lightbox = visitor.locator('.yarl__root');
  await expectImagesLoaded(visitor, '.yarl__slide_current img');
  const downloading = visitor.waitForEvent('download');
  await lightbox.getByRole('button', { name: 'Download' }).click();
  expect((await downloading).suggestedFilename()).toBe('Ticket Original.jpg');

  expect(urls.some((url) => url.includes('/download-ticket'))).toBe(true);
  for (const url of urls) {
    expect(url).not.toContain(token!);
    expect(url).not.toMatch(/[?&]access=/);
  }

  // The API reads the token from its header only.
  const inQuery = await visitor.request.get(`${PUBLIC}/api/galleries/${slug}/photos?access=${encodeURIComponent(token!)}`);
  expect(inQuery.status()).toBe(403);
  const inHeader = await visitor.request.get(`${PUBLIC}/api/galleries/${slug}/photos`, {
    headers: { 'X-Gallery-Access': token! },
  });
  expect(inHeader.status()).toBe(200);
  await visitor.close();
});
