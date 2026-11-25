import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, adminApi, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

// What an unfurler reads: the HTML as served, with no JavaScript run and no cookies.
const CRAWLER = { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' };

async function previewTags(request: APIRequestContext, path: string) {
  const res = await request.get(`${PUBLIC}${path}`, { headers: CRAWLER });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-cache');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  const html = await res.text();
  const tag = (attr: string, key: string) =>
    [...html.matchAll(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'g'))].map((m) => m[1]);
  return {
    html,
    title: html.match(/<title>([^<]*)<\/title>/)?.[1],
    ogTitle: tag('property', 'og:title'),
    ogDescription: tag('property', 'og:description'),
    ogImage: tag('property', 'og:image'),
    ogUrl: tag('property', 'og:url'),
    twitterImage: tag('name', 'twitter:image'),
  };
}

test('a public gallery link previews with its title, description and cover', async ({ page, playwright }) => {
  const api = adminApi(page.request);
  const slug = uniqueSlug('preview');
  const gallery = await api.createGallery({
    title: 'Preview & Smoke',
    slug,
    is_public: true,
    description: 'Shared links show this gallery.',
  });
  const photo = await api.upload(gallery.id, 'preview.jpg', uniqueJpeg('preview'));
  await api.setStatus(photo.id, 'shown');

  const crawler = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  const tags = await previewTags(crawler, `/g/${slug}`);
  expect(tags.title).toBe('Preview &amp; Smoke | Jacob Fain Photography');
  expect(tags.ogTitle).toEqual(['Preview &amp; Smoke']);
  expect(tags.ogDescription).toEqual(['Shared links show this gallery.']);
  expect(tags.ogUrl).toEqual([`${PUBLIC}/g/${slug}`]);
  expect(tags.ogImage).toHaveLength(1);
  expect(tags.ogImage[0]).toMatch(new RegExp(`^${PUBLIC}/api/share/g/${slug}/cover\\.jpg\\?v=[0-9a-f]+$`));
  expect(tags.twitterImage).toEqual(tags.ogImage);
  // The page is still the app: the same bundles as every other page.
  expect(tags.html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/);

  // The image is served from the site itself, not a URL that expires.
  const cover = await crawler.get(tags.ogImage[0], { headers: CRAWLER });
  expect(cover.status()).toBe(200);
  expect(cover.headers()['content-type']).toBe('image/jpeg');
  expect(cover.headers()['cache-control']).toBe('public, max-age=3600');

  // A private gallery's link gives nothing away.
  const hidden = uniqueSlug('preview-private');
  const secret = await api.createGallery({
    title: 'Secret Smoke',
    slug: hidden,
    is_public: false,
    password: 'open-sesame',
    description: 'Never in a preview.',
  });
  await api.setStatus((await api.upload(secret.id, 'secret.jpg', uniqueJpeg('secret'))).id, 'shown');
  const siteDefaults = await previewTags(crawler, '/galleries');
  const privateTags = await previewTags(crawler, `/g/${hidden}`);
  expect(privateTags.html).toBe(siteDefaults.html);
  expect(privateTags.html).not.toContain('Secret Smoke');
  expect((await crawler.get(`${PUBLIC}/api/share/g/${hidden}/cover.jpg`)).status()).toBe(404);
  await crawler.dispose();
});
