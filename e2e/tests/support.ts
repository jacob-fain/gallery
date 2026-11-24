import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8443';
export const PUBLIC = `https://gallery.localhost:${port}`;
export const ADMIN = `https://manage.gallery.localhost:${port}`;

// Seeded by the stack's seed service (compose.yml).
export const ADMIN_EMAIL = 'admin@e2e.test';
export const ADMIN_PASSWORD = 'e2e-admin-password';

/** Browser state holding the shared admin session (admin.setup.ts). */
export const ADMIN_STATE = path.join(import.meta.dirname, '../.auth/admin.json');

const fixture = readFileSync(path.join(import.meta.dirname, '../fixtures/photo.jpg'));

/**
 * The fixture JPEG with a comment segment naming `label` after its SOI
 * marker. Uploads are deduplicated by content, so each test needs bytes of
 * its own.
 */
export function uniqueJpeg(label: string): Buffer {
  const text = Buffer.from(`${label} ${Date.now()} ${Math.random()}`);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(text.length + 2);
  return Buffer.concat([fixture.subarray(0, 2), Buffer.from([0xff, 0xfe]), length, text, fixture.subarray(2)]);
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function signIn(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
}

/**
 * Admin API calls with the browser context's session cookie, sent with the
 * admin Origin as the admin UI's own requests are.
 */
export function adminApi(request: APIRequestContext) {
  const headers = { Origin: ADMIN };
  const ok = async <T>(response: APIResponse): Promise<T> => {
    expect(response.ok(), `${response.url()} answered ${response.status()}`).toBe(true);
    return (await response.json()).data as T;
  };
  return {
    createGallery: async (body: { title: string; slug: string; is_public: boolean; password?: string }) =>
      ok<{ id: string; slug: string }>(await request.post(`${ADMIN}/api/galleries`, { headers, data: body })),
    upload: async (galleryId: string, name: string, buffer: Buffer) =>
      ok<{ id: string }>(
        await request.post(`${ADMIN}/api/photos/upload`, {
          headers,
          multipart: { galleryId, photo: { name, mimeType: 'image/jpeg', buffer } },
        })
      ),
    setHidden: async (photoId: string, isHidden: boolean) =>
      ok(await request.put(`${ADMIN}/api/photos/${photoId}`, { headers, data: { is_hidden: isHidden } })),
  };
}

/** Waits until every image matched has loaded with real pixels. */
export async function expectImagesLoaded(page: Page, selector: string): Promise<void> {
  const images = page.locator(selector);
  await expect(images.first()).toBeVisible();
  await expect
    .poll(() =>
      images.evaluateAll((els) =>
        (els as HTMLImageElement[]).every((img) => img.complete && img.naturalWidth > 0)
      )
    )
    .toBe(true);
}
