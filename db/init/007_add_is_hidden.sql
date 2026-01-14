-- Add is_hidden column to photos table for hiding photos from public view
ALTER TABLE photos ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- Index for efficient filtering of hidden photos
CREATE INDEX IF NOT EXISTS idx_photos_is_hidden ON photos(is_hidden);
