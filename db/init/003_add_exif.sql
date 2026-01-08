-- Add EXIF metadata column to photos table
ALTER TABLE photos ADD COLUMN IF NOT EXISTS exif_data JSONB DEFAULT NULL;
