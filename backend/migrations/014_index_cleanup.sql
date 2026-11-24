-- Index cleanup (#70). Every index on photos is rewritten on each non-HOT
-- update, and an update can only be HOT when it changes no indexed column
-- and the new row version fits on the same page.

-- view_count changes on every gallery and lightbox view. Indexing it made
-- each of those updates non-HOT. The top-five dashboard queries read whole
-- small tables and sort, which needs no index.
DROP INDEX IF EXISTS idx_photos_view_count;
DROP INDEX IF EXISTS idx_galleries_view_count;

-- Redundant: a leading prefix of another index on the same table.
DROP INDEX IF EXISTS idx_galleries_slug;          -- galleries_slug_key (UNIQUE)
DROP INDEX IF EXISTS idx_photos_gallery_id;       -- idx_photos_sort_order (gallery_id, sort_order)
DROP INDEX IF EXISTS idx_analytics_event_type;    -- idx_analytics_type_date (event_type, created_at)

-- Unused: no query filters on these. Booleans this unselective are read by
-- sequential scan, and the homepage order is served by
-- idx_photos_featured_order.
DROP INDEX IF EXISTS idx_photos_is_featured;
DROP INDEX IF EXISTS idx_photos_is_hidden;
DROP INDEX IF EXISTS idx_photos_featured_uploaded;
DROP INDEX IF EXISTS idx_galleries_is_public;

-- A gallery's public photos and its cover fallback both read
-- WHERE gallery_id = $1 AND is_hidden = false ORDER BY sort_order, uploaded_at.
CREATE INDEX idx_photos_gallery_visible_order
  ON photos (gallery_id, sort_order, uploaded_at)
  WHERE is_hidden = false;

-- Room on each page for the new version of an updated row, so counter
-- updates stay HOT. Applies to pages written from now on.
ALTER TABLE photos SET (fillfactor = 90);
