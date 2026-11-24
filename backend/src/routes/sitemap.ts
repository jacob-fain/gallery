import { Request, Response } from 'express';
import { createRouter } from '../middleware/requestLog';
import { buildSitemap, getSitemapGallerySlugs } from '../services/sitemapService';
import { logger } from '../utils/logger';
import { siteOrigin } from '../utils/siteOrigin';

/** Short enough that a newly published gallery is listed within minutes. */
export const SITEMAP_MAX_AGE_SECONDS = 300;

const router = createRouter();

// Served to crawlers at /sitemap.xml by nginx.
router.get('/sitemap.xml', async (req: Request, res: Response) => {
  try {
    const slugs = await getSitemapGallerySlugs();
    res.set('Cache-Control', `public, max-age=${SITEMAP_MAX_AGE_SECONDS}`);
    res.type('application/xml').send(buildSitemap(siteOrigin(req), slugs));
  } catch (err) {
    logger.error('Error building sitemap', { err });
    res.status(500).json({ success: false, error: 'Failed to build sitemap' });
  }
});

export default router;
