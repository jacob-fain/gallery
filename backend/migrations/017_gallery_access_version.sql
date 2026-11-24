-- Gallery access tokens carry the gallery's access_version, and every use
-- checks it. Bumping it (when the password is set, changed or removed, or the
-- gallery's visibility changes) revokes every access token issued before.
-- The previous release ignores the column, so it stays compatible.
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS access_version INTEGER NOT NULL DEFAULT 0;
