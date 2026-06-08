-- Stores XP pair-programming assignments scoped to a project.
-- Each row represents one active driver/navigator pair; hard-delete removes it.
CREATE TABLE xp_pairs (
  pair_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(project_id),
  member1_id INTEGER NOT NULL REFERENCES users(user_id),
  member2_id INTEGER NOT NULL REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_xp_pairs_project ON xp_pairs(project_id);
