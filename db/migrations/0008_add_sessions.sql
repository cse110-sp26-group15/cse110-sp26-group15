-- Server-side session store. Until now the login/signup handlers generated a
-- random token and set it as the `sitrep_token` cookie but never persisted it,
-- so the server could not resolve a cookie back to a user. Each row maps an
-- opaque token to the authenticated user and an absolute expiry; the global
-- middleware looks the token up here to populate `context.userId`, and logout
-- deletes the row so a session can be revoked server-side (not just cleared in
-- the browser). `expires_at` mirrors the cookie's Max-Age (7 days).
CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Speeds up "all sessions for a user" (revoke-all / cleanup on user delete).
-- The schema does not run with PRAGMA foreign_keys=ON, so cascading deletes
-- must be done by hand — this index keeps that cheap.
CREATE INDEX idx_sessions_user ON sessions(user_id);
