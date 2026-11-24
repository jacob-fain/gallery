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
  gallery_id: string | null;
  gallery_title: string;
  thumbnail_key: string;
  view_count: number;
  download_count: number;
}

export interface StorageStats {
  total_bytes: number;
  /** One row per gallery, plus an Unassigned row (id null) for photos in no gallery. */
  galleries: {
    id: string | null;
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
 * The dashboard's day boundary. Days are counted on the site owner's wall
 * clock, not the database session's timezone (UTC in containers), so an
 * evening view lands on the day it happened.
 */
export const DASHBOARD_TIMEZONE = 'America/New_York';

/**
 * Counts rows per calendar day in DASHBOARD_TIMEZONE for the last `days`
 * days, today included, with a zero for each empty day. The window starts at
 * local midnight so the first day is whole, and the day keys are built in SQL
 * so neither Node's nor Postgres's own timezone can shift them.
 */
const countPerDay = async (
  table: 'analytics_events' | 'photos',
  column: 'created_at' | 'uploaded_at',
  filter: string,
  days: number,
  now: Date
): Promise<{ date: string; count: number }[]> => {
  const result = await query(
    `WITH bounds AS (
       SELECT ($3::timestamptz AT TIME ZONE $1)::date AS today
     ),
     day_list AS (
       SELECT d::date AS day
       FROM bounds, generate_series((today - ($2::int - 1))::timestamp, today::timestamp, interval '1 day') AS d
     ),
     counts AS (
       SELECT (${column} AT TIME ZONE $1)::date AS day, COUNT(*)::int AS n
       FROM ${table}, bounds
       WHERE ${filter}
         AND ${column} >= (today - ($2::int - 1))::timestamp AT TIME ZONE $1
         AND ${column} < (today + 1)::timestamp AT TIME ZONE $1
       GROUP BY 1
     )
     SELECT to_char(day_list.day, 'YYYY-MM-DD') AS date, COALESCE(counts.n, 0) AS count
     FROM day_list LEFT JOIN counts USING (day)
     ORDER BY day_list.day`,
    [DASHBOARD_TIMEZONE, days, now]
  );
  return result.rows.map((row: { date: string; count: number }) => ({ date: row.date, count: row.count }));
};

/**
 * Gallery views per DASHBOARD_TIMEZONE day for the last `days` days, today
 * included. Days before the rollup watermark are read from analytics_daily
 * (their raw events may have been deleted by retention); later days are
 * counted from analytics_events. Each day comes from exactly one source, so
 * a rollup never changes a reported number.
 */
export const getViewsOverTime = async (days: number = 30, now: Date = new Date()): Promise<ViewsOverTime[]> => {
  const result = await query(
    `WITH bounds AS (
       SELECT today, today - ($2::int - 1) AS first_day,
              (SELECT rolled_through FROM analytics_rollup_state) AS rolled_through
       FROM (SELECT ($3::timestamptz AT TIME ZONE $1)::date AS today) t
     ),
     day_list AS (
       SELECT d::date AS day
       FROM bounds, generate_series(first_day::timestamp, today::timestamp, interval '1 day') AS d
     ),
     raw AS (
       SELECT (created_at AT TIME ZONE $1)::date AS day, COUNT(*)::int AS n
       FROM analytics_events, bounds
       WHERE event_type = 'gallery_view'
         AND created_at >= GREATEST(first_day, rolled_through)::timestamp AT TIME ZONE $1
         AND created_at < (today + 1)::timestamp AT TIME ZONE $1
       GROUP BY 1
     ),
     rolled AS (
       SELECT day, SUM(count)::int AS n
       FROM analytics_daily, bounds
       WHERE event_type = 'gallery_view'
         AND day >= first_day
         AND day < rolled_through
         AND day <= today
       GROUP BY 1
     )
     SELECT to_char(day_list.day, 'YYYY-MM-DD') AS date, COALESCE(raw.n, rolled.n, 0) AS views
     FROM day_list
       LEFT JOIN raw USING (day)
       LEFT JOIN rolled USING (day)
     ORDER BY day_list.day`,
    [DASHBOARD_TIMEZONE, days, now]
  );
  return result.rows.map((row: { date: string; views: number }) => ({ date: row.date, views: row.views }));
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
            COALESCE(g.title, 'Unassigned') as gallery_title, p.s3_thumbnail_key as thumbnail_key,
            p.view_count, p.download_count
    FROM photos p
    LEFT JOIN galleries g ON p.gallery_id = g.id
    ORDER BY p.view_count DESC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map((row: { id: string; filename: string; gallery_id: string | null; gallery_title: string; thumbnail_key: string; view_count: number; download_count: number }) => ({
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
      UNION ALL
      SELECT NULL, 'Unassigned', COALESCE(SUM(file_size), 0)
      FROM photos
      WHERE gallery_id IS NULL
      ORDER BY bytes DESC`
    ),
  ]);

  const originalTotal = parseInt(totalResult.rows[0].total_bytes, 10);

  return {
    total_bytes: Math.round(originalTotal * STORAGE_MULTIPLIER),
    galleries: breakdownResult.rows.map((row: { id: string | null; title: string; bytes: string }) => ({
      id: row.id,
      title: row.title,
      bytes: Math.round(parseInt(row.bytes, 10) * STORAGE_MULTIPLIER),
    })),
  };
};

/**
 * Get upload activity (photos uploaded per day, last N days)
 */
export const getUploadActivity = async (days: number = 30, now: Date = new Date()): Promise<UploadActivity[]> =>
  countPerDay('photos', 'uploaded_at', 'TRUE', days, now);

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
