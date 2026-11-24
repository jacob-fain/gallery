import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import { getSitemapGallerySlugs } from './sitemapService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('getSitemapGallerySlugs (database)', () => {
  const created: string[] = [];

  const gallery = async (isPublic: boolean, passwordHash: string | null) => {
    const slug = `sitemap-${crypto.randomBytes(4).toString('hex')}`;
    const { rows } = await query(
      `INSERT INTO galleries (title, slug, is_public, password_hash) VALUES ($1, $1, $2, $3) RETURNING id`,
      [slug, isPublic, passwordHash]
    );
    created.push(rows[0].id);
    return slug;
  };

  afterAll(async () => {
    if (created.length) {
      await query(`DELETE FROM galleries WHERE id = ANY($1)`, [created]);
    }
  });

  it('lists public galleries without a password and never private ones', async () => {
    const open = await gallery(true, null);
    const privateWithPassword = await gallery(false, '$2b$10$hash');
    const privateWithout = await gallery(false, null);
    const publicWithPassword = await gallery(true, '$2b$10$hash');

    const slugs = await getSitemapGallerySlugs();
    expect(slugs).toContain(open);
    expect(slugs).not.toContain(privateWithPassword);
    expect(slugs).not.toContain(privateWithout);
    expect(slugs).not.toContain(publicWithPassword);
  });

  it('follows the public gallery order', async () => {
    const first = await gallery(true, null);
    const second = await gallery(true, null);
    await query(`UPDATE galleries SET sort_order = 1 WHERE slug = $1`, [first]);
    await query(`UPDATE galleries SET sort_order = 2 WHERE slug = $1`, [second]);
    const slugs = await getSitemapGallerySlugs();
    expect(slugs.indexOf(first)).toBeLessThan(slugs.indexOf(second));
  });
});
