import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { coverUrl, escapeHtml, renderSharePage, type ShareGallery } from './sharePreview';

// The real page, so a change to its tags that the renderer no longer finds fails here.
const INDEX = readFileSync(path.join(__dirname, '../../../frontend/index.html'), 'utf8');
const ORIGIN = 'https://jacobfain.gallery';

const gallery = (over: Partial<ShareGallery> = {}): ShareGallery => ({
  slug: 'iceland',
  title: 'Iceland',
  description: 'Black sand and glaciers.',
  coverWebKey: 'galleries/g1/p1/web.webp',
  ...over,
});

/** Every `content` value of the meta tags `attr="key"`. */
const meta = (html: string, attr: 'name' | 'property', key: string): string[] =>
  [...html.matchAll(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'g'))].map((m) => m[1]);

describe('renderSharePage', () => {
  it('describes the gallery in every preview tag, once each', () => {
    const html = renderSharePage(INDEX, gallery(), ORIGIN);
    const image = coverUrl(ORIGIN, { ...gallery(), coverWebKey: 'galleries/g1/p1/web.webp' });
    expect(image).toMatch(/^https:\/\/jacobfain\.gallery\/api\/share\/g\/iceland\/cover\.jpg\?v=[0-9a-f]{12}$/);

    expect(html).toContain('<title>Iceland | Jacob Fain Photography</title>');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(meta(html, 'property', 'og:title')).toEqual(['Iceland']);
    expect(meta(html, 'name', 'twitter:title')).toEqual(['Iceland']);
    expect(meta(html, 'name', 'description')).toEqual(['Black sand and glaciers.']);
    expect(meta(html, 'property', 'og:description')).toEqual(['Black sand and glaciers.']);
    expect(meta(html, 'name', 'twitter:description')).toEqual(['Black sand and glaciers.']);
    expect(meta(html, 'property', 'og:image')).toEqual([image]);
    expect(meta(html, 'name', 'twitter:image')).toEqual([image]);
    expect(meta(html, 'property', 'og:image:width')).toEqual(['1200']);
    expect(meta(html, 'property', 'og:image:height')).toEqual(['630']);
    expect(meta(html, 'property', 'og:image:alt')).toEqual(['Cover photo of Iceland']);
    expect(meta(html, 'property', 'og:url')).toEqual(['https://jacobfain.gallery/g/iceland']);
    expect(html).toContain('<link rel="canonical" href="https://jacobfain.gallery/g/iceland" />');
    expect(meta(html, 'property', 'og:site_name')).toEqual(['Jacob Fain Photography']);
    // The rest of the page is untouched.
    expect(html).toContain('<script src="/theme.js"></script>');
    expect(html).toContain('<div id="root"></div>');
  });

  it('escapes every value it writes', () => {
    const hostile = `</title><script>alert("x")</script> & 'quotes' $& $1`;
    const html = renderSharePage(INDEX, gallery({ title: hostile, description: hostile }), ORIGIN);
    const escaped = '&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39; $&amp; $1';
    expect(html).not.toContain('<script>alert');
    expect(html).toContain(`<title>${escaped} | Jacob Fain Photography</title>`);
    expect(meta(html, 'property', 'og:title')).toEqual([escaped]);
    expect(meta(html, 'name', 'description')).toEqual([escaped]);
    expect(meta(html, 'property', 'og:image:alt')).toEqual([`Cover photo of ${escaped}`]);
  });

  it('keeps the site description and image when the gallery has neither', () => {
    const html = renderSharePage(INDEX, gallery({ description: '  ', coverWebKey: null }), ORIGIN);
    expect(meta(html, 'name', 'description')).toEqual(meta(INDEX, 'name', 'description'));
    expect(meta(html, 'property', 'og:description')).toEqual(meta(INDEX, 'property', 'og:description'));
    expect(meta(html, 'property', 'og:image')).toEqual(['https://jacobfain.gallery/og-image.jpg']);
    expect(meta(html, 'name', 'twitter:image')).toEqual(['https://jacobfain.gallery/og-image.jpg']);
    expect(meta(html, 'property', 'og:title')).toEqual(['Iceland']);
  });

  it('cuts a long description', () => {
    const html = renderSharePage(INDEX, gallery({ description: 'a'.repeat(1000) }), ORIGIN);
    expect(meta(html, 'property', 'og:description')[0]).toHaveLength(300);
  });

  it('gives a new cover a new image URL', () => {
    expect(coverUrl(ORIGIN, { ...gallery(), coverWebKey: 'a' })).not.toBe(
      coverUrl(ORIGIN, { ...gallery(), coverWebKey: 'b' })
    );
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
