-- GET /api/photos pages the visible photos newest first by keyset:
-- WHERE is_hidden = false AND (uploaded_at, id) < (cursor) ORDER BY
-- uploaded_at DESC, id DESC. Each page reads its rows from this index and
-- stops, instead of sorting every visible photo (#69).
CREATE INDEX idx_photos_public_recent
  ON photos (uploaded_at DESC, id DESC)
  WHERE is_hidden = false;
