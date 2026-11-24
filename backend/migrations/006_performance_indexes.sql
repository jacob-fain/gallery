-- Performance indexes for common queries

-- Featured photos query: ORDER BY uploaded_at
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at DESC);

-- Top photos ranking: ORDER BY view_count
CREATE INDEX IF NOT EXISTS idx_photos_view_count ON photos(view_count DESC);

-- Top galleries ranking: ORDER BY view_count
CREATE INDEX IF NOT EXISTS idx_galleries_view_count ON galleries(view_count DESC);

-- Featured photos composite: WHERE is_featured ORDER BY uploaded_at
CREATE INDEX IF NOT EXISTS idx_photos_featured_uploaded
  ON photos(is_featured, uploaded_at DESC) WHERE is_featured = true;

-- Cover image foreign key lookup
CREATE INDEX IF NOT EXISTS idx_galleries_cover_image_id
  ON galleries(cover_image_id) WHERE cover_image_id IS NOT NULL;
