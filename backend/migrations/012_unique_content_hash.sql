-- One photo per content hash, enforced by the database so two uploads of the
-- same file that pass the duplicate check at the same moment cannot both be
-- stored (#57). Photos without a hash (never backfilled) are not constrained.
--
-- Existing duplicates are never deleted here: which copy to keep is a
-- decision about real photos. The migration stops with the list instead, and
-- the deploy keeps running the previous release until the extra copies are
-- removed through the admin UI.
DO $$
DECLARE
  shared integer;
  listing text;
BEGIN
  SELECT count(*), string_agg(content_hash || ' (photos ' || ids || ')', '; ')
  INTO shared, listing
  FROM (
    SELECT content_hash, string_agg(id::text, ', ' ORDER BY uploaded_at) AS ids
    FROM photos
    WHERE content_hash IS NOT NULL
    GROUP BY content_hash
    HAVING count(*) > 1
  ) dupes;

  IF shared > 0 THEN
    RAISE EXCEPTION 'Cannot make photos.content_hash unique: % hash(es) belong to more than one photo. Delete the extra copies, then migrate again. %', shared, listing;
  END IF;
END $$;

CREATE UNIQUE INDEX photos_content_hash_key ON photos (content_hash)
  WHERE content_hash IS NOT NULL;

-- The unique index serves every content_hash lookup the plain one did.
DROP INDEX idx_photos_content_hash;
