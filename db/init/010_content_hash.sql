-- SHA-256 of the original upload bytes, for duplicate detection.
-- Originals are stored exactly as uploaded, so hashing a file on disk
-- reproduces the stored hash.
ALTER TABLE photos ADD COLUMN content_hash VARCHAR(64);
CREATE INDEX idx_photos_content_hash ON photos(content_hash);
