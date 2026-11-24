import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { query } from '../config/db';
import { generateGalleryAccessToken } from '../services/authService';
import { drainTracking } from '../services/eventTracking';
import app from '../app';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('POST /galleries/:slug/view (database)', () => {
  const galleries: string[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (galleries.length) await query(`DELETE FROM galleries WHERE id = ANY($1)`, [galleries]);
  });

  const gallery = async (isPublic: boolean) => {
    const slug = `view-${crypto.randomBytes(4).toString('hex')}`;
    const { rows } = await query(
      `INSERT INTO galleries (title, slug, is_public, password_hash) VALUES ($1, $1, $2, $3) RETURNING id`,
      [slug, isPublic, isPublic ? null : '$2b$10$hash']
    );
    galleries.push(rows[0].id);
    return { id: rows[0].id as string, slug };
  };

  const view = async (slug: string, access?: string) => {
    const qs = access ? `?access=${encodeURIComponent(access)}` : '';
    const res = await fetch(`${base}/galleries/${slug}/view${qs}`, { method: 'POST' });
    await drainTracking();
    return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
  };

  const viewCount = async (id: string) =>
    (await query(`SELECT view_count FROM galleries WHERE id = $1`, [id])).rows[0].view_count;

  it('counts a public gallery view, and reading the gallery counts nothing', async () => {
    const g = await gallery(true);

    const res = await view(g.slug);
    expect(res).toEqual({ status: 200, cache: 'no-store', body: { success: true } });
    expect(await viewCount(g.id)).toBe(1);

    await fetch(`${base}/galleries/${g.slug}`);
    await drainTracking();
    expect(await viewCount(g.id)).toBe(1);
  });

  it('counts a private gallery view only with a token for that gallery', async () => {
    const g = await gallery(false);
    const other = await gallery(false);

    expect((await view(g.slug)).body).toEqual({ success: true });
    await view(g.slug, 'not-a-token');
    await view(g.slug, generateGalleryAccessToken(other.id, other.slug, 0));
    expect(await viewCount(g.id)).toBe(0);

    await view(g.slug, generateGalleryAccessToken(g.id, g.slug, 0));
    expect(await viewCount(g.id)).toBe(1);
  });

  it('answers an unknown slug the same way', async () => {
    expect(await view('no-such-gallery')).toEqual({ status: 200, cache: 'no-store', body: { success: true } });
  });
});
