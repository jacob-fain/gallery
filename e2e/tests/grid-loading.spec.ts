import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, WIDE_FIXTURE, adminApi, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const PHOTOS = 15;
let slug: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage({ storageState: ADMIN_STATE });
  const api = adminApi(page.request);
  slug = uniqueSlug('grid');
  const gallery = await api.createGallery({ title: 'Grid loading', slug, is_public: true });
  for (let i = 0; i < PHOTOS; i++) {
    const photo = await api.upload(gallery.id, `grid-${i}.jpg`, uniqueJpeg(`grid-${i}`));
    await api.setStatus(photo.id, 'shown');
  }
  await page.close();
});

// Image responses arrive 150 to 400 ms late, as from S3 over a real
// connection. With `failFirst`, each image's first request is cut off.
async function delayImages(page: Page, { failFirst = false } = {}) {
  const seen = new Set<string>();
  await page.route('https://s3.e2e.amazonaws.com/**', async (route) => {
    const url = route.request().url();
    const first = !seen.has(url);
    seen.add(url);
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));
    if (failFirst && first) return route.abort('connectionreset');
    return route.continue().catch(() => {});
  });
}

// A tile's full image; its preview sits in an img before it.
const tiles = (page: Page) => page.locator('.react-photo-album img[data-tile]');

// Every tile shows its photo once it is on screen: loaded with real pixels
// and not hidden as failed. Tiles download as they come into reach of the
// viewport and are cancelled once scrolled past, so this scrolls through the
// grid a screen at a time and checks the tiles on screen at each stop.
async function expectAllTilesLoaded(page: Page) {
  await expect(tiles(page)).toHaveCount(PHOTOS);
  const seen = new Set<number>();
  for (let y = 0; ; ) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await expect
      .poll(
        () =>
          tiles(page).evaluateAll((els) =>
            (els as HTMLImageElement[]).filter((img) => {
              const rect = img.getBoundingClientRect();
              const onScreen = rect.bottom > 0 && rect.top < innerHeight;
              return onScreen && (!(img.complete && img.naturalWidth > 0) || 'failed' in img.dataset);
            }).length
          ),
        { timeout: 15_000 }
      )
      .toBe(0);
    const onScreen = await tiles(page).evaluateAll((els) =>
      els.flatMap((img, i) => {
        const rect = img.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight ? [i] : [];
      })
    );
    onScreen.forEach((i) => seen.add(i));
    const { height, bottom } = await page.evaluate(() => ({
      height: innerHeight,
      bottom: scrollY + innerHeight >= document.documentElement.scrollHeight - 1,
    }));
    if (bottom) break;
    y += height;
  }
  expect(seen.size).toBe(PHOTOS);
}

test('rapid shuffles leave every photo loaded', async ({ page }) => {
  await delayImages(page);
  await page.goto(`${PUBLIC}/g/${slug}`);
  await expect(tiles(page)).toHaveCount(PHOTOS);

  const shuffle = page.getByRole('button', { name: 'Shuffle photos' });
  await expect(shuffle).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await shuffle.click();
    await page.waitForTimeout(100);
  }

  await expectAllTilesLoaded(page);
});

test('a photo whose download is cut off is retried and shows', async ({ page }) => {
  await delayImages(page, { failFirst: true });
  await page.goto(`${PUBLIC}/g/${slug}`);
  await expectAllTilesLoaded(page);
});

for (const failures of [2, 3]) {
  test(`a photo whose first ${failures} requests fail is retried until it shows`, async ({ page }) => {
    test.setTimeout(90_000);
    // Every image request fails until it has been tried this many times, as
    // during an outage at the image host. Retries reuse the same URL.
    const attempts = new Map<string, number>();
    await page.route('https://s3.e2e.amazonaws.com/**', async (route) => {
      const url = route.request().url();
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      if (attempt <= failures) return route.fulfill({ status: 503, body: 'SlowDown' });
      return route.continue().catch(() => {});
    });
    await page.setViewportSize({ width: 1280, height: 2400 });
    await page.goto(`${PUBLIC}/g/${slug}`);
    await expect
      .poll(
        () =>
          tiles(page).evaluateAll(
            (els) => (els as HTMLImageElement[]).filter((img) => img.complete && img.naturalWidth > 0 && !('failed' in img.dataset)).length
          ),
        { timeout: 30_000 }
      )
      .toBe(PHOTOS);
    expect(Math.max(...attempts.values())).toBe(failures + 1);
  });
}

test('tiles below the viewport start loading before they are scrolled to', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await delayImages(page);
  await page.goto(`${PUBLIC}/g/${slug}`);
  await expect(tiles(page)).toHaveCount(PHOTOS);

  // Tiles within a screen below the fold are already requested.
  await expect
    .poll(() =>
      tiles(page).evaluateAll((els) =>
        (els as HTMLImageElement[])
          .filter((img) => {
            const top = img.getBoundingClientRect().top;
            return top >= innerHeight && top < 2 * innerHeight;
          })
          .map((img) => img.currentSrc !== '')
      )
    )
    .not.toContain(false);
  const ahead = await tiles(page).evaluateAll(
    (els) => els.filter((img) => img.getBoundingClientRect().top >= innerHeight).length
  );
  expect(ahead).toBeGreaterThan(0);
});

test('a tile shows its preview while a slow full image loads, then the full image', async ({ browser, page: adminPage }) => {
  const api = adminApi(adminPage.request);
  const wideSlug = uniqueSlug('preview');
  const gallery = await api.createGallery({ title: 'Previews', slug: wideSlug, is_public: true });
  const photo = await api.upload(gallery.id, 'wide.jpg', uniqueJpeg('wide', WIDE_FIXTURE));
  await api.setStatus(photo.id, 'shown');

  // At 2x the tile takes the web size; at 1x the thumbnail would be its
  // full image and no preview would be needed.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // Previews (thumbnails) arrive at once, full images 3 seconds late.
  await page.route('https://s3.e2e.amazonaws.com/**', async (route) => {
    if (!/thumb\.webp/.test(route.request().url())) await new Promise((resolve) => setTimeout(resolve, 3000));
    return route.continue().catch(() => {});
  });
  await page.goto(`${PUBLIC}/g/${wideSlug}`);
  const first = tiles(page).first();
  const preview = page.locator('.react-photo-album img[data-preview]').first();

  await expect(preview).toHaveAttribute('data-due', '');
  await expect(preview).toHaveAttribute('data-shown', '');
  await expect(preview).toHaveCSS('opacity', '1');
  await expect(first).toHaveCSS('opacity', '0');

  await expect(first).toHaveAttribute('data-loaded', '', { timeout: 10_000 });
  await expect(first).toHaveCSS('opacity', '1');
  await expect(preview).toHaveCSS('visibility', 'hidden');
  expect(await first.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('web.webp');
  await context.close();
});
