-- Add featured_order column for explicit homepage photo ordering
-- 0 = hero photo, 1+ = featured photos in display order, NULL = not on homepage
ALTER TABLE photos ADD COLUMN IF NOT EXISTS featured_order INTEGER DEFAULT NULL;

-- Create index for efficient featured photo queries
CREATE INDEX IF NOT EXISTS idx_photos_featured_order ON photos(featured_order) WHERE featured_order IS NOT NULL;

-- Migrate existing featured photos: set featured_order based on upload date
-- Hero (0) = most recent featured, others get 1, 2, 3...
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY uploaded_at DESC) - 1 as new_order
  FROM photos
  WHERE is_featured = true
)
UPDATE photos p
SET featured_order = r.new_order
FROM ranked r
WHERE p.id = r.id;
