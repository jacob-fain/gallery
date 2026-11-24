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
