import { query } from '../config/db';

/** Public pages of the SPA, as paths under the site origin. */
export const STATIC_PATHS = ['/', '/galleries', '/photos'];

/**
 * Slugs of the galleries anyone can open. A password hash on a public
 * gallery is excluded too: the sitemap lists only pages a crawler can read.
 */
export const getSitemapGallerySlugs = async (): Promise<string[]> => {
  const result = await query(
    `SELECT slug FROM galleries
     WHERE is_public = true AND password_hash IS NULL
     ORDER BY sort_order ASC, created_at DESC`
  );
  return result.rows.map((row: { slug: string }) => row.slug);
};

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

export const buildSitemap = (origin: string, gallerySlugs: string[]): string => {
  const base = origin.replace(/\/+$/, '');
  const paths = [...STATIC_PATHS, ...gallerySlugs.map((slug) => `/g/${encodeURIComponent(slug)}`)];
  const urls = paths.map((path) => `  <url><loc>${escapeXml(base + path)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
};
