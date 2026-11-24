import { Request, Response } from 'express';
import { createRouter } from '../middleware/requestLog';
import { isGallerySlug } from '../middleware/validateIds';
import { getIndexHtml } from '../services/indexHtml';
import { getCoverJpeg, getShareGallery, renderSharePage } from '../services/sharePreview';
import { logger } from '../utils/logger';
import { siteOrigin } from '../utils/siteOrigin';

/**
 * Long enough that unfurlers and Cloudflare rarely ask twice, short enough
 * that a gallery made private stops serving its cover from caches within the
 * hour. A new cover photo gets a new URL (coverUrl), so this never delays one.
 */
export const COVER_MAX_AGE_SECONDS = 3600;

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
 * no preview, whatever the reason.
 */
router.get('/g/:slug/cover.jpg', async (req: Request, res: Response) => {
  const notFound = () => res.status(404).json({ success: false, error: 'Not found' });
  const { slug } = req.params;
  try {
    const gallery = isGallerySlug(slug) ? await getShareGallery(slug) : null;
    if (!gallery?.coverWebKey) return notFound();
    const jpeg = await getCoverJpeg(gallery.coverWebKey);
    res.set('Cache-Control', `public, max-age=${COVER_MAX_AGE_SECONDS}`);
    res.type('jpeg').send(jpeg);
  } catch (err) {
    logger.error('Error rendering a share cover', { err });
    res.status(500).json({ success: false, error: 'Failed to render cover' });
  }
});

export default router;
