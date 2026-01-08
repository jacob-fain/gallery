-- Add sort_order to galleries for custom ordering on home page
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Create index for efficient ordering
CREATE INDEX IF NOT EXISTS idx_galleries_sort_order ON galleries(sort_order);
