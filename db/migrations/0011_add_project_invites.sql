-- Pending project invites for emails that don't yet have a user account.
-- Resolved into project_members when the invitee signs up and joins.
CREATE TABLE project_invites (
    invite_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    email       TEXT NOT NULL,
    invited_by  INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, email),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (invited_by) REFERENCES users(user_id)
);
