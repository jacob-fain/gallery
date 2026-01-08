import { Request, Response } from 'express';
import * as settingsService from '../services/settingsService';

/**
 * Get all site settings (public)
 */
export const getSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await settingsService.getAllSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
};

/**
 * Update site settings (admin only)
 */
export const updateSettings = async (req: Request, res: Response) => {
  try {
    const { site_title, meta_description } = req.body;

    const settings = await settingsService.updateSettings({
      site_title,
      meta_description,
    });

    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
};
