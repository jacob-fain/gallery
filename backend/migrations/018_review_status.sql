-- Every photo has one of three review states (#256): 'review' (new uploads,
-- private), 'shown' (public) and 'rejected' (private, kept until deleted).
-- Public queries read review_status = 'shown'.
ALTER TABLE photos ADD COLUMN review_status TEXT NOT NULL DEFAULT 'review'
  CONSTRAINT photos_review_status_check CHECK (review_status IN ('review', 'shown', 'rejected'));

-- Visible photos become shown. Hidden ones become rejected: before this
-- column there was no way to tell a photo nobody has looked at from one set
-- aside. A null is_hidden was never listed publicly, so it is not shown.
UPDATE photos
SET review_status = CASE WHEN is_hidden = false THEN 'shown' ELSE 'rejected' END,
    is_hidden = (is_hidden IS DISTINCT FROM false);

-- is_hidden stays for one release, so the previous release, which reads and
-- writes only is_hidden, still never shows a photo that is not shown. This
-- trigger keeps is_hidden = (review_status <> 'shown') on every write:
-- - a write that changes review_status sets is_hidden from it;
-- - a write from the previous release, which changes only is_hidden, sets
--   review_status the way the backfill does (shown, or rejected);
-- - an insert takes review_status (its default is review), whatever
--   is_hidden says, so the previous release's uploads land in review.
-- The column, this trigger and the is_hidden partial indexes are dropped in
-- a later release, once no running code reads is_hidden (#257).
CREATE FUNCTION photos_sync_is_hidden() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.review_status IS NOT DISTINCT FROM OLD.review_status
     AND NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
    NEW.review_status := CASE WHEN NEW.is_hidden = false THEN 'shown' ELSE 'rejected' END;
  END IF;
  NEW.is_hidden := NEW.review_status <> 'shown';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UPDATE OF: view and download counter updates do not fire it.
CREATE TRIGGER photos_sync_is_hidden
  BEFORE INSERT OR UPDATE OF is_hidden, review_status ON photos
  FOR EACH ROW EXECUTE FUNCTION photos_sync_is_hidden();

-- A gallery's photos by status in gallery order: the admin status filters,
-- the per-status counts, and the public gallery and cover fallback
-- (gallery_id = $1 AND review_status = 'shown' ORDER BY sort_order,
-- uploaded_at). Unassigned photos are the gallery_id IS NULL range.
CREATE INDEX idx_photos_gallery_status_order
  ON photos (gallery_id, review_status, sort_order, uploaded_at, id);

-- Photos by status newest first: the admin All Photos filters and the
-- public All Photos keyset (review_status = 'shown' ORDER BY uploaded_at
-- DESC, id DESC).
CREATE INDEX idx_photos_status_recent
  ON photos (review_status, uploaded_at DESC, id DESC);
