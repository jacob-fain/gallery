-- Allow photos to exist without a gallery (unassigned uploads)
ALTER TABLE photos ALTER COLUMN gallery_id DROP NOT NULL;
