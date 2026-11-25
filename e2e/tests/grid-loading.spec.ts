import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, adminApi, uniqueJpeg, uniqueSlug } from './support';

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

const tiles = (page: Page) => page.locator('.react-photo-album img');

// Every tile shows its photo: loaded with real pixels and not hidden as failed.
async function expectAllTilesLoaded(page: Page) {
  // Lazy tiles below the fold load once they are near the viewport.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(
      () =>
        tiles(page).evaluateAll((els) =>
          (els as HTMLImageElement[]).filter((img) => !(img.complete && img.naturalWidth > 0) || 'failed' in img.dataset)
            .length
        ),
      { timeout: 15_000 }
    )
    .toBe(0);
  await expect(tiles(page)).toHaveCount(PHOTOS);
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
  await expect(tiles(page)).toHaveCount(PHOTOS);
  await expectAllTilesLoaded(page);
});

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
