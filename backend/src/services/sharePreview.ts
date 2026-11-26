import crypto from 'crypto';
import sharp from 'sharp';
import type { Readable } from 'stream';
import { getPublicGalleryCoverKeys } from './galleryService';
import { MAX_INPUT_PIXELS } from './imageService';
import { getFileStream } from './s3Service';
import { Semaphore } from '../utils/semaphore';

/**
 * What a link preview may show of a gallery. Only a public gallery with no
 * password has one; every other slug gets the site defaults, so a preview
 * never tells a private gallery apart from a missing one.
 */
export interface ShareGallery {
  slug: string;
  title: string;
  description: string | null;
  coverWebKey: string | null;
}

export const getShareGallery = async (slug: string): Promise<ShareGallery | null> => {
  const [row] = await getPublicGalleryCoverKeys(slug);
  if (!row || row.password_hash) return null;
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverWebKey: row.cover_web_key,
  };
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Unfurlers cut descriptions far shorter than this; it only bounds the page size. */
const MAX_DESCRIPTION_LENGTH = 300;

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 630;

/** Names the cover photo without revealing its S3 key. */
export const coverVersion = (coverWebKey: string): string =>
  crypto.createHash('sha256').update(coverWebKey).digest('hex').slice(0, 12);

/**
 * The cover's preview URL. The query names the photo, and the route serves
 * only the current one, so a URL for a cover that has since changed or been
 * rejected stops working instead of serving the old photo.
 */
export const coverUrl = (origin: string, gallery: ShareGallery & { coverWebKey: string }): string =>
  `${origin}/api/share/g/${gallery.slug}/cover.jpg?v=${coverVersion(gallery.coverWebKey)}`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sets the content of the meta tag `attr="key"`, adding the tag before
 * </head> when the page has none. `value` must already be escaped. The
 * replacement is a function so a "$" in a title is never read as a pattern.
 */
const setMeta = (html: string, attr: 'name' | 'property', key: string, value: string): string => {
  const tag = new RegExp(`(<meta\\s+${attr}="${escapeRegExp(key)}"\\s+content=")[^"]*(")`);
  if (tag.test(html)) return html.replace(tag, (_m, open: string, close: string) => open + value + close);
  return html.replace('</head>', () => `  <meta ${attr}="${key}" content="${value}" />\n  </head>`);
};

const setCanonical = (html: string, url: string): string => {
  const tag = /(<link\s+rel="canonical"\s+href=")[^"]*(")/;
  if (tag.test(html)) return html.replace(tag, (_m, open: string, close: string) => open + url + close);
  return html.replace('</head>', () => `  <link rel="canonical" href="${url}" />\n  </head>`);
};

/**
 * index.html with the title, description, Open Graph, Twitter and canonical
 * tags describing `gallery`. Tags the gallery has nothing for (no
 * description, no visible photo) keep the site defaults. The page title
 * follows the SPA's "Gallery | Site" form, with the static title as the site.
 */
export const renderSharePage = (html: string, gallery: ShareGallery, origin: string): string => {
  const title = escapeHtml(gallery.title);
  const pageUrl = escapeHtml(`${origin}/g/${gallery.slug}`);
  let out = html.replace(/<title>([^<]*)<\/title>/, (_m, site: string) => `<title>${title} | ${site}</title>`);

  out = setMeta(out, 'property', 'og:title', title);
  out = setMeta(out, 'name', 'twitter:title', title);
  out = setMeta(out, 'property', 'og:url', pageUrl);
  out = setCanonical(out, pageUrl);

  const description = gallery.description?.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  if (description) {
    const value = escapeHtml(description);
    out = setMeta(out, 'name', 'description', value);
    out = setMeta(out, 'property', 'og:description', value);
    out = setMeta(out, 'name', 'twitter:description', value);
  }

  if (gallery.coverWebKey) {
    const image = escapeHtml(coverUrl(origin, { ...gallery, coverWebKey: gallery.coverWebKey }));
    out = setMeta(out, 'property', 'og:image', image);
    out = setMeta(out, 'property', 'og:image:width', String(COVER_WIDTH));
    out = setMeta(out, 'property', 'og:image:height', String(COVER_HEIGHT));
    out = setMeta(out, 'property', 'og:image:alt', escapeHtml(`Cover photo of ${gallery.title}`));
    out = setMeta(out, 'name', 'twitter:image', image);
  }
  return out;
};

/**
 * Cover renders at once, process wide. One is enough for link unfurlers, and
 * it sits beside the two upload slots (imageService.ts) rather than in them,
 * so a batch upload never makes a preview wait for minutes, while sharp work
 * stays bounded at three images. A render decodes the web derivative (at
 * most 1920 px wide), a few tens of MB at peak.
 */
const coverSlots = new Semaphore(1);

/** About 100 KB each, so the cache stays within a few MB. */
export const COVER_CACHE_ENTRIES = 32;

// Keyed by the web derivative's S3 key, which changes with the cover photo.
const coverCache = new Map<string, Buffer>();
const rendering = new Map<string, Promise<Buffer>>();

const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const renderCover = async (webKey: string): Promise<Buffer> => {
  const source = await readAll(await getFileStream(webKey));
  return sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 82 })
    .toBuffer();
};

/** The cover as a 1200x630 JPEG, rendered once per photo and kept in a small LRU. */
export const getCoverJpeg = async (webKey: string): Promise<Buffer> => {
  const hit = coverCache.get(webKey);
  if (hit) {
    coverCache.delete(webKey);
    coverCache.set(webKey, hit);
    return hit;
  }
  // Unfurlers often fetch a new link from several places at once; they share one render.
  let pending = rendering.get(webKey);
  if (!pending) {
    pending = coverSlots.run(() => renderCover(webKey)).then((jpeg) => {
      coverCache.set(webKey, jpeg);
      while (coverCache.size > COVER_CACHE_ENTRIES) coverCache.delete(coverCache.keys().next().value!);
      return jpeg;
    });
    rendering.set(webKey, pending);
    void pending.then(
      () => rendering.delete(webKey),
      () => rendering.delete(webKey)
    );
  }
  return pending;
};

/** Empties the cover cache (tests). */
export const resetCoverCache = (): void => {
  coverCache.clear();
};
