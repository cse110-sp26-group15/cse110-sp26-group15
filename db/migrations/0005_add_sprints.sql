-- Sprints table: tracks discrete sprint cycles per project.
-- One row per sprint; the "current" sprint is whichever row contains
-- today's date in [start_date, end_date].
CREATE TABLE sprints (
    sprint_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    goal TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

-- Speeds up the "current sprint for this project" lookup.
CREATE INDEX idx_sprints_project_date ON sprints(project_id, start_date, end_date);
