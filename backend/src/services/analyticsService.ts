import { query } from '../config/db';

export interface ViewsOverTime {
  date: string;
  views: number;
}

export interface TopGallery {
  id: string;
  title: string;
  slug: string;
  view_count: number;
}

export interface TopPhoto {
  id: string;
  filename: string;
  gallery_id: string;
  gallery_title: string;
  thumbnail_key: string;
  view_count: number;
  download_count: number;
}

export interface StorageStats {
  total_bytes: number;
  galleries: {
    id: string;
    title: string;
    bytes: number;
  }[];
}

export interface UploadActivity {
  date: string;
  count: number;
}

export interface AnalyticsData {
  viewsOverTime: ViewsOverTime[];
  uploadActivity: UploadActivity[];
  topGalleries: TopGallery[];
  topPhotos: TopPhoto[];
  storage: StorageStats;
}

/**
 * Get views over time (last N days, grouped by day)
 */
export const getViewsOverTime = async (days: number = 30): Promise<ViewsOverTime[]> => {
  const result = await query(
    `SELECT
      DATE(created_at) as date,
      COUNT(*) as views
    FROM analytics_events
    WHERE event_type = 'gallery_view'
      AND created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC`
  );

  // Fill in missing days with 0 views
  const viewsByDate = new Map(
    result.rows.map((row: { date: Date; views: string }) => [
      row.date.toISOString().split('T')[0],
      parseInt(row.views, 10),
    ])
  );

  const filledData: ViewsOverTime[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    filledData.push({
      date: dateStr,
      views: viewsByDate.get(dateStr) || 0,
    });
  }

  return filledData;
};

/**
 * Get top galleries by views
 */
export const getTopGalleries = async (limit: number = 5): Promise<TopGallery[]> => {
  const result = await query(
    `SELECT id, title, slug, view_count
    FROM galleries
    ORDER BY view_count DESC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map((row: { id: string; title: string; slug: string; view_count: number }) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    view_count: row.view_count,
  }));
};

/**
 * Get top photos by views
 */
export const getTopPhotos = async (limit: number = 5): Promise<TopPhoto[]> => {
  const result = await query(
    `SELECT p.id, p.original_filename as filename, p.gallery_id,
            g.title as gallery_title, p.s3_thumbnail_key as thumbnail_key,
            p.view_count, p.download_count
    FROM photos p
    JOIN galleries g ON p.gallery_id = g.id
    ORDER BY p.view_count DESC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map((row: { id: string; filename: string; gallery_id: string; gallery_title: string; thumbnail_key: string; view_count: number; download_count: number }) => ({
    id: row.id,
    filename: row.filename,
    gallery_id: row.gallery_id,
    gallery_title: row.gallery_title,
    thumbnail_key: row.thumbnail_key,
    view_count: row.view_count,
    download_count: row.download_count,
  }));
};

/**
 * Get storage statistics by gallery
 * Note: file_size is original only. We estimate total S3 storage as:
 * original (100%) + web (~15%) + thumbnail (~2%) = ~117% of file_size
 */
const STORAGE_MULTIPLIER = 1.17;

export const getStorageStats = async (): Promise<StorageStats> => {
  const [totalResult, breakdownResult] = await Promise.all([
    query(`SELECT COALESCE(SUM(file_size), 0) as total_bytes FROM photos`),
    query(
      `SELECT g.id, g.title, COALESCE(SUM(p.file_size), 0) as bytes
      FROM galleries g
      LEFT JOIN photos p ON p.gallery_id = g.id
      GROUP BY g.id, g.title
      ORDER BY bytes DESC`
    ),
  ]);

  const originalTotal = parseInt(totalResult.rows[0].total_bytes, 10);

  return {
    total_bytes: Math.round(originalTotal * STORAGE_MULTIPLIER),
    galleries: breakdownResult.rows.map((row: { id: string; title: string; bytes: string }) => ({
      id: row.id,
      title: row.title,
      bytes: Math.round(parseInt(row.bytes, 10) * STORAGE_MULTIPLIER),
    })),
  };
};

/**
 * Get upload activity (photos uploaded per day, last N days)
 */
export const getUploadActivity = async (days: number = 30): Promise<UploadActivity[]> => {
  const result = await query(
    `SELECT
      DATE(uploaded_at) as date,
      COUNT(*) as count
    FROM photos
    WHERE uploaded_at >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(uploaded_at)
    ORDER BY date ASC`
  );

  // Fill in missing days with 0 uploads
  const uploadsByDate = new Map(
    result.rows.map((row: { date: Date; count: string }) => [
      row.date.toISOString().split('T')[0],
      parseInt(row.count, 10),
    ])
  );

  const filledData: UploadActivity[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    filledData.push({
      date: dateStr,
      count: uploadsByDate.get(dateStr) || 0,
    });
  }

  return filledData;
};

/**
 * Get all analytics data in one call
 */
export const getAllAnalytics = async (): Promise<AnalyticsData> => {
  const [viewsOverTime, uploadActivity, topGalleries, topPhotos, storage] = await Promise.all([
    getViewsOverTime(30),
    getUploadActivity(30),
    getTopGalleries(5),
    getTopPhotos(5),
    getStorageStats(),
  ]);

  return {
    viewsOverTime,
    uploadActivity,
    topGalleries,
    topPhotos,
    storage,
  };
};
