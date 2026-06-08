-- Password-reset tokens issued by POST /api/auth/forgot-password and
-- consumed by POST /api/auth/reset-password. The token itself is opaque
-- (32 random bytes) and is the only thing handed to the user via the
-- reset link; it expires after 1 hour and is hard-deleted on use so a
-- single reset link can be redeemed exactly once. used_at is recorded
-- (rather than deleting the row immediately) so a redemption is auditable.
CREATE TABLE password_resets (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used_at    TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Speeds up "all reset tokens for this user" (invalidate when password
-- changes successfully). Mirrors idx_sessions_user.
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
