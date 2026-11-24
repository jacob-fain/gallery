import { query } from '../config/db';

export interface SiteSettings {
  site_title: string;
  meta_description: string;
  [key: string]: string;
}

/**
 * Get all site settings as a key-value object
 */
export const getAllSettings = async (): Promise<SiteSettings> => {
  const result = await query('SELECT key, value FROM site_settings');

  const settings: SiteSettings = {
    site_title: '',
    meta_description: '',
  };

  for (const row of result.rows) {
    settings[row.key] = row.value || '';
  }

  return settings;
};

/**
 * Get a single setting by key
 */
export const getSetting = async (key: string): Promise<string | null> => {
  const result = await query(
    'SELECT value FROM site_settings WHERE key = $1',
    [key]
  );
  return result.rows[0]?.value || null;
};

/**
 * Update a single setting
 */
export const updateSetting = async (key: string, value: string): Promise<void> => {
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
};

/**
 * Update multiple settings at once, in one statement so either every key is
 * saved or none is.
 */
export const updateSettings = async (settings: Partial<SiteSettings>): Promise<SiteSettings> => {
  const entries = Object.entries(settings).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  );
  if (entries.length > 0) {
    await query(
      `INSERT INTO site_settings (key, value, updated_at)
       SELECT key, value, CURRENT_TIMESTAMP FROM unnest($1::text[], $2::text[]) AS t(key, value)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [entries.map(([key]) => key), entries.map(([, value]) => value)]
    );
  }
  return getAllSettings();
};
