import { Request, Response } from 'express';
import * as settingsService from '../services/settingsService';
import { validateSiteLinks } from '../services/siteLinks';
import { cachePublicly } from '../middleware/cacheControl';
import { logger } from '../utils/logger';

/**
 * Get all site settings (public)
 */
export const getSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await settingsService.getAllSettings();
    cachePublicly(res);
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error('Error fetching settings', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
};

/**
 * Update site settings (admin only)
 */
export const updateSettings = async (req: Request, res: Response) => {
  try {
    const { site_title, meta_description, instagram_url, contact_email } = req.body;

    const links = validateSiteLinks({ instagram_url, contact_email });
    if (!links.ok) {
      return res.status(400).json({ success: false, error: links.error });
    }

    const settings = await settingsService.updateSettings({
      site_title,
      meta_description,
      ...links.values,
    });

    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error('Error updating settings', { err });
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
};
