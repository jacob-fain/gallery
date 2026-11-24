-- Admin tokens carry the user's token_version, and every request checks it.
-- Bumping it (on logout, or on a password change) revokes every token issued
-- before. The previous release ignores the column, so it stays compatible.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
