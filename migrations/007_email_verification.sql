-- Migration 007: Email verification fields for users
ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN verification_token TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN verification_token_expires_at TEXT DEFAULT NULL;

-- Mark existing users as verified so existing accounts continue working without disruption
UPDATE users SET is_verified = 1 WHERE is_verified IS NULL OR is_verified = 0;
