import { readFileSync } from 'node:fs';
import path from 'node:path';
import { devices, expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { ADMIN_STATE, PUBLIC, WIDE_FIXTURE, adminApi, uniqueJpeg, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE, actionTimeout: 15_000, navigationTimeout: 15_000 });

// 4000px wide, so it has an original larger than its 1920px web size.
const LARGE_FIXTURE = readFileSync(path.join(import.meta.dirname, '../fixtures/large.jpg'));
const PORTRAIT_FIXTURE = readFileSync(path.join(import.meta.dirname, '../fixtures/portrait.jpg'));
const IPHONE = devices['iPhone 15'];

async function seedGallery(page: Page, label: string, count: number) {
  const api = adminApi(page.request);
  const gallery = await api.createGallery({ title: `Phone ${label}`, slug: uniqueSlug(label), is_public: true });
  const bases = [LARGE_FIXTURE, WIDE_FIXTURE, PORTRAIT_FIXTURE];
  for (let i = 0; i < count; i++) {
    const name = `${label}-${i}.jpg`;
    const photo = await api.upload(gallery.id, name, uniqueJpeg(name, bases[i % bases.length]));
    await api.setStatus(photo.id, 'shown');
  }
  return gallery;
}

async function phone(browser: Browser, width = 390, height = 844): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ ...IPHONE, viewport: { width, height } });
  const page = await context.newPage();
  return { context, page, cdp: await context.newCDPSession(page) };
}

// A rotation as the device reports it: new size and screen orientation, with
// the orientationchange event.
async function rotate(cdp: CDPSession, width: number, height: number) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
  });
}

async function touchTap(cdp: CDPSession, x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinch(cdp: CDPSession, cx: number, cy: number, from: number, to: number) {
  const points = (d: number) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + ((to - from) * i) / 12) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// The floating buttons' boxes, and whether a tap at each one's centre lands on it.
function floatingControls(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[aria-label="Layout"] button, button[aria-label="Shuffle photos"], button[aria-label="Download all photos as ZIP"]'
      ),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        name: el.getAttribute('aria-label') ?? el.textContent,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        tappable: !!hit && el.contains(hit),
      };
    })
  );
}

test('phone portrait: Shuffle, the layout switch and Download are all on screen and tappable', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const gallery = await seedGallery(page, 'controls', 3);
  for (const width of [320, 375, 390]) {
    const { context, page: visitor } = await phone(browser, width, 700);
    for (const url of [`${PUBLIC}/photos`, `${PUBLIC}/g/${gallery.slug}`]) {
      await visitor.goto(url);
      await expect(visitor.getByRole('button', { name: 'Shuffle photos' })).toBeVisible();
      const controls = await floatingControls(visitor);
      const names = controls.map((c) => c.name);
      expect(names).toEqual(
        url.includes('/g/')
          ? ['Columns', 'Collage', 'Shuffle photos', 'Download all photos as ZIP']
          : ['Columns', 'Collage', 'Shuffle photos']
      );
      for (const c of controls) {
        expect(c, `${c.name} at ${width}px on ${url}`).toMatchObject({ tappable: true });
        expect(c.height, `${c.name} height`).toBeGreaterThanOrEqual(44);
        expect(c.width, `${c.name} width`).toBeGreaterThanOrEqual(44);
        expect(c.left).toBeGreaterThanOrEqual(0);
        expect(c.right).toBeLessThanOrEqual(width);
      }
      for (let i = 0; i < controls.length; i++)
        for (let j = i + 1; j < controls.length; j++) {
          const [a, b] = [controls[i], controls[j]];
          const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(overlap, `${a.name} over ${b.name}`).toBe(false);
        }
    }
    await context.close();
  }
});

test('rotating a phone keeps the collage at the new width and the photo in view', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const gallery = await seedGallery(page, 'rotate', 12);
  const { context, page: visitor, cdp } = await phone(browser);
  await visitor.goto(`${PUBLIC}/g/${gallery.slug}`);
  await visitor.evaluate(() => localStorage.setItem('gridLayout', 'collage'));
  await visitor.reload();
  await expect(visitor.locator('button[data-photo-index]').first()).toBeVisible();

  // Scrolled to a photo partway down.
  const anchorIndex = await visitor.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>('button[data-photo-index]')];
    const tile = tiles[Math.min(6, tiles.length - 1)];
    window.scrollTo(0, tile.getBoundingClientRect().top + window.scrollY - 100);
    return tile.dataset.photoIndex!;
  });
  await visitor.waitForTimeout(300);

  await rotate(cdp, 844, 390);
  // At once, not after a debounce: the old arrangement never shows at the new width.
  await visitor.waitForTimeout(60);
  const facts = await visitor.evaluate((index) => {
    const album = document.querySelector('[aria-label="Photo album"]')!.getBoundingClientRect();
    const tiles = [...document.querySelectorAll<HTMLElement>('button[data-photo-index]')].map((t) => t.getBoundingClientRect());
    const anchor = document.querySelector(`button[data-photo-index="${index}"]`)!.getBoundingClientRect();
    return { albumWidth: album.width, right: Math.max(...tiles.map((t) => t.right)) - album.left, anchorTop: anchor.top, anchorBottom: anchor.bottom };
  }, anchorIndex);
  expect(Math.abs(facts.right - facts.albumWidth)).toBeLessThan(2);

  await visitor.waitForTimeout(900);
  const settled = await visitor.evaluate((index) => {
    const r = document.querySelector(`button[data-photo-index="${index}"]`)!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: innerHeight };
  }, anchorIndex);
  // The photo the visitor was on is still on screen.
  expect(settled.bottom).toBeGreaterThan(0);
  expect(settled.top).toBeLessThan(settled.height);
  await context.close();
});

test('viewer on a phone: a tap hides the overlays, a swipe keeps them hidden, a tap brings them back', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const gallery = await seedGallery(page, 'overlay', 3);
  const { context, page: visitor, cdp } = await phone(browser, 844, 390);
  await visitor.goto(`${PUBLIC}/g/${gallery.slug}`);
  await visitor.locator('.react-photo-album--photo').first().click();
  const toolbar = visitor.locator('.yarl__toolbar');
  await expect(toolbar).toBeVisible();
  const opacity = () => toolbar.evaluate((el) => Number(getComputedStyle(el).opacity));
  await expect.poll(opacity).toBe(1);

  await touchTap(cdp, 422, 200);
  await expect.poll(opacity).toBe(0);

  // A swipe to the next photo.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 200, id: 1 }] });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 700 - i * 55, y: 200, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await visitor.waitForTimeout(700);
  expect(await opacity()).toBe(0);

  await touchTap(cdp, 422, 200);
  await expect.poll(opacity).toBe(1);
  await context.close();
});

test('pinching deep into a photo swaps in the original without counting a download', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const gallery = await seedGallery(page, 'zoom', 1);
  const { context, page: visitor, cdp } = await phone(browser);
  const requests: string[] = [];
  visitor.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await visitor.goto(`${PUBLIC}/g/${gallery.slug}`);
  await visitor.locator('.react-photo-album--photo').first().click();
  const shown = () =>
    visitor.evaluate(() => {
      const imgs = [...document.querySelectorAll<HTMLImageElement>('.yarl__slide_current img.yarl__slide_image')];
      const img = imgs.find((i) => getComputedStyle(i).visibility !== 'hidden');
      return img?.naturalWidth ?? 0;
    });
  await expect.poll(shown).toBe(1920);

  // A small zoom stays on the web size.
  await pinch(cdp, 195, 422, 30, 40);
  await visitor.waitForTimeout(800);
  expect(requests.filter((p) => p.endsWith('/original'))).toEqual([]);

  await pinch(cdp, 195, 422, 20, 160);
  await expect.poll(shown, { timeout: 15_000 }).toBe(4000);
  expect(requests.filter((p) => p.endsWith('/original'))).toHaveLength(1);
  expect(requests.filter((p) => p.endsWith('/download'))).toEqual([]);
  // Zoom and position held through the swap: still zoomed in.
  const scale = await visitor.evaluate(() =>
    Number(document.querySelector<HTMLElement>('.yarl__slide_current .yarl__slide_wrapper')!.style.transform.match(/scale\(([\d.]+)\)/)![1])
  );
  expect(scale).toBeGreaterThan(2);
  await context.close();
});

test('the single layout shows one photo per row at the content width, tall photos within the screen', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const gallery = await seedGallery(page, 'single', 3);
  const visitor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await visitor.goto(`${PUBLIC}/g/${gallery.slug}`);
  await visitor.getByRole('button', { name: 'Single', exact: true }).click();
  expect(await visitor.evaluate(() => localStorage.getItem('gridLayout'))).toBe('single');
  const tiles = await visitor.locator('button[data-photo-index]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height, center: r.left + r.width / 2 };
    })
  );
  expect(tiles).toHaveLength(3);
  // 1440 less the grid's 48px gutters.
  expect(tiles.some((t) => Math.abs(t.width - 1344) < 1)).toBe(true);
  for (const t of tiles) {
    expect(t.height).toBeLessThanOrEqual(900 - 64 + 1);
    expect(Math.abs(t.center - 720)).toBeLessThan(2);
  }
  await visitor.reload();
  await expect(visitor.getByRole('button', { name: 'Single', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // A phone shows columns for a stored single, and offers no single.
  const { context, page: onPhone } = await phone(browser);
  await onPhone.goto(`${PUBLIC}/g/${gallery.slug}`);
  await onPhone.evaluate(() => localStorage.setItem('gridLayout', 'single'));
  await onPhone.reload();
  await expect(onPhone.getByRole('button', { name: 'Columns', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(onPhone.getByRole('button', { name: 'Single', exact: true })).toHaveCount(0);
  await context.close();
  await visitor.close();
});

test('a gallery keeps its order through a reload and a photo opened and closed', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const gallery = await seedGallery(page, 'order', 6);
  const visitor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await visitor.goto(`${PUBLIC}/g/${gallery.slug}`);
  await visitor.evaluate(() => localStorage.setItem('gridLayout', 'collage'));
  await visitor.reload();
  const order = () =>
    visitor
      .locator('button[data-photo-index] img[data-tile]')
      .evaluateAll((imgs) => imgs.map((img) => (img.getAttribute('data-src') ?? '').split('?')[0]));
  await expect(visitor.locator('button[data-photo-index]')).toHaveCount(6);
  const dealt = await order();

  await visitor.locator('button[data-photo-index]').nth(2).click();
  await visitor.keyboard.press('Escape');
  expect(await order()).toEqual(dealt);

  await visitor.reload();
  await expect(visitor.locator('button[data-photo-index]')).toHaveCount(6);
  expect(await order()).toEqual(dealt);
  await visitor.close();
});
