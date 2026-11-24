-- The MIME type of each photo's stored original, read from its bytes at
-- upload (#87). Downloads use it to give the file a matching extension.
--
-- Photos uploaded before this column existed keep NULL: their originals were
-- stored under "original.jpg" with image/jpeg whatever their real format, so
-- neither the key nor the S3 type says what the bytes are.
ALTER TABLE photos ADD COLUMN original_content_type VARCHAR(50);
