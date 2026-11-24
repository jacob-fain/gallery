import { describe, expect, it } from 'vitest';
import { buildSitemap, escapeXml } from './sitemapService';

describe('buildSitemap', () => {
  it('lists the public pages and each gallery under the origin', () => {
    const xml = buildSitemap('https://jacobfain.gallery/', ['iceland', 'tokyo-2024']);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://jacobfain.gallery/',
      'https://jacobfain.gallery/galleries',
      'https://jacobfain.gallery/photos',
      'https://jacobfain.gallery/g/iceland',
      'https://jacobfain.gallery/g/tokyo-2024',
    ]);
  });

  it('escapes slugs so they cannot break the XML', () => {
    const xml = buildSitemap('https://example.test', ["a&b<c>'\""]);
    expect(xml).toContain('<loc>https://example.test/g/a%26b%3Cc%3E&apos;%22</loc>');
    expect(xml).not.toMatch(/<loc>[^<]*[<>"][^<]*<\/loc>/);
  });

  it('escapes an origin with markup characters', () => {
    expect(buildSitemap('https://x.test/?a=1&b=2', [])).toContain('<loc>https://x.test/?a=1&amp;b=2/</loc>');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});
