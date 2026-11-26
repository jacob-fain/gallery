import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, adminApi, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE, actionTimeout: 15_000, navigationTimeout: 15_000 });

const portrait = readFileSync(path.join(import.meta.dirname, '../fixtures/portrait.jpg'));

// The portrait fixture with a comment segment of its own, as uniqueJpeg does
// for the landscape one: uploads are deduplicated by content.
function uniquePortrait(label: string): Buffer {
  const text = Buffer.from(`${label} ${Date.now()} ${Math.random()}`);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(text.length + 2);
  return Buffer.concat([portrait.subarray(0, 2), Buffer.from([0xff, 0xfe]), length, text, portrait.subarray(2)]);
}

// Each tile's photo and its box: together, the arrangement.
function arrangement(page: Page) {
  return page.locator('button[data-photo-index]').evaluateAll((tiles) =>
    (tiles as HTMLElement[]).map((tile) => {
      const img = tile.querySelector('img[data-tile]')!;
      return `${img.alt} ${tile.style.left} ${tile.style.top} ${tile.style.width} ${tile.style.height}`;
    })
  );
}

test('the collage on All Photos shows photos uncropped, and Back from a photo keeps the arrangement', async ({
  page,
  browser,
}) => {
  // Six uploads, each processed into its sizes, are slow while other specs run.
  test.setTimeout(90_000);
  const api = adminApi(page.request);
  const gallery = await api.createGallery({ title: 'Collage smoke', slug: uniqueSlug('collage'), is_public: true });
  for (let i = 0; i < 6; i++) {
    const name = `collage-${i}.jpg`;
    const photo = await api.upload(gallery.id, name, i % 2 ? uniquePortrait(name) : uniqueJpeg(name));
    await api.setStatus(photo.id, 'shown');
  }

  const visitor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await visitor.goto(`${PUBLIC}/photos`);
  await expect(visitor.getByRole('button', { name: 'Columns', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await visitor.getByRole('button', { name: 'Collage', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Collage', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await visitor.evaluate(() => localStorage.getItem('gridLayout'))).toBe('collage');

  // Every tile on screen holds its whole photo at the photo's own shape.
  const onScreen = visitor.locator('button[data-photo-index]').filter({ visible: true });
  await expect(onScreen.first()).toBeVisible();
  await expect
    .poll(() =>
      visitor.locator('button[data-photo-index]').evaluateAll((tiles) =>
        (tiles as HTMLElement[])
          .filter((tile) => tile.getBoundingClientRect().top < window.innerHeight)
          .every((tile) => {
            const img = tile.querySelector('img[data-tile]')!;
            return img.complete && img.naturalWidth > 0;
          })
      )
    )
    .toBe(true);
  const shapes = await visitor.locator('button[data-photo-index]').evaluateAll((tiles) =>
    (tiles as HTMLElement[])
      .filter((tile) => tile.getBoundingClientRect().top < window.innerHeight)
      .map((tile) => {
        const img = tile.querySelector('img[data-tile]')!;
        const box = tile.getBoundingClientRect();
        const shown = img.getBoundingClientRect();
        return {
          // The height the photo's own shape gives the tile's width.
          heightError: Math.abs(box.width / (img.naturalWidth / img.naturalHeight) - box.height),
          // The image fills the tile exactly: nothing cut off.
          fillError: Math.abs(shown.width - box.width) + Math.abs(shown.height - box.height),
          portrait: img.naturalHeight > img.naturalWidth,
        };
      })
  );
  expect(shapes.length).toBeGreaterThan(1);
  expect(shapes.some((s) => s.portrait)).toBe(true);
  for (const shape of shapes) {
    expect(shape.heightError).toBeLessThan(1);
    expect(shape.fillError).toBeLessThan(1);
  }

  const before = await arrangement(visitor);
  const lightbox = visitor.locator('.yarl__root');
  await visitor.locator('button[data-photo-index="1"]').click();
  await expect(lightbox).toBeVisible();
  expect(new URL(visitor.url()).searchParams.get('photo')).not.toBeNull();

  await visitor.goBack();
  await expect(lightbox).toHaveCount(0);
  expect(await arrangement(visitor)).toEqual(before);

  // Shuffle deals another.
  await visitor.getByRole('button', { name: 'Shuffle photos' }).click();
  await expect.poll(() => arrangement(visitor)).not.toEqual(before);
  await visitor.close();
});
