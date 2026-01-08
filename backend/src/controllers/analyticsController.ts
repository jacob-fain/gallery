import { Request, Response } from 'express';
import * as analyticsService from '../services/analyticsService';
import { getSignedUrl } from '../services/s3Service';

/**
 * Get all analytics data for the admin dashboard
 */
export const getAnalytics = async (_req: Request, res: Response) => {
  try {
    const analytics = await analyticsService.getAllAnalytics();

    // Enrich top photos with signed thumbnail URLs
    const topPhotosWithUrls = await Promise.all(
      analytics.topPhotos.map(async (photo) => ({
        ...photo,
        thumbnailUrl: await getSignedUrl(photo.thumbnail_key),
      }))
    );

    res.json({
      success: true,
      data: {
        ...analytics,
        topPhotos: topPhotosWithUrls,
      },
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
};
