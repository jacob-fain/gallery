import { Request, Response } from 'express';
import { createRouter } from '../middleware/requestLog';
import { isGallerySlug } from '../middleware/validateIds';
import { getIndexHtml } from '../services/indexHtml';
import {
  coverUrl,
  coverVersion,
  getCoverJpeg,
  getShareGallery,
  renderSharePage,
} from '../services/sharePreview';
import { logger } from '../utils/logger';
import { siteOrigin } from '../utils/siteOrigin';

/**
 * How long any cache may keep a cover. A URL names its photo (coverUrl) and
 * stops being served once the cover changes, so a cache that already holds
 * it is the only way an old cover is still seen: this bounds that tail, at
 * the edge (s-maxage) and in browsers. Unfurlers that honour it fetch the
 * image again every few minutes, which the render cache answers without S3,
 * and a stale link previews with no image rather than the old one. Many
 * unfurlers keep their own copy whatever the headers say; nothing here
 * reaches those.
 */
export const COVER_MAX_AGE_SECONDS = 300;

const router = createRouter();

/**
 * nginx sends page loads of /g/<slug> here, since crawlers and link
 * unfurlers read the HTML without running the app. The answer is the SPA's
 * index.html, with the gallery's tags for a public gallery with no password
 * and unchanged for any other slug, so the page says nothing about a private
 * one. no-cache like the static file: it names the current bundles (#151).
 */
router.get('/g/:slug', async (req: Request, res: Response) => {
  let html: string;
  try {
    html = await getIndexHtml();
  } catch (err) {
    // nginx serves its own index.html in place of any 5xx from here.
    logger.warn('index.html unavailable for a share page', { err });
    res.status(502).type('text/plain').send('index.html unavailable');
    return;
  }
  res.set('Cache-Control', 'no-cache');
  res.type('html');
  const { slug } = req.params;
  try {
    const gallery = isGallerySlug(slug) ? await getShareGallery(slug) : null;
    res.send(gallery ? renderSharePage(html, gallery, siteOrigin(req)) : html);
  } catch (err) {
    logger.error('Error building a share page', { err });
    res.send(html);
  }
});

/**
 * A stable og:image for a public gallery: presigned S3 URLs expire long
 * before an unfurler's cache does. The same 404 for every gallery that has
 * no preview, whatever the reason, and for a version that is not the current
 * cover. A URL with no version redirects to the current one, so the image a
 * cache stores is always under a versioned URL.
 */
router.get('/g/:slug/cover.jpg', async (req: Request, res: Response) => {
  const notFound = () => res.status(404).json({ success: false, error: 'Not found' });
  const { slug } = req.params;
  const { v } = req.query;
  try {
    const gallery = isGallerySlug(slug) ? await getShareGallery(slug) : null;
    if (!gallery?.coverWebKey) return notFound();
    const current = { ...gallery, coverWebKey: gallery.coverWebKey };
    if (v === undefined) return res.redirect(302, coverUrl(siteOrigin(req), current));
    if (v !== coverVersion(current.coverWebKey)) return notFound();
    const jpeg = await getCoverJpeg(current.coverWebKey);
    res.set('Cache-Control', `public, max-age=${COVER_MAX_AGE_SECONDS}, s-maxage=${COVER_MAX_AGE_SECONDS}`);
    res.type('jpeg').send(jpeg);
  } catch (err) {
    logger.error('Error rendering a share cover', { err });
    res.status(500).json({ success: false, error: 'Failed to render cover' });
  }
});

export default router;
