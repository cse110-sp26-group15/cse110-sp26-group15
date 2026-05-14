-- Initial Schema

-- users table: stores team members and potential AI agents
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT, -- 'developer', 'manager', 'AI-agent'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- projects table
CREATE TABLE projects (
    project_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- project_members table: many-to-many relationship between users and projects
CREATE TABLE project_members (
    project_id INTEGER,
    user_id INTEGER,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- tasks table
CREATE TABLE tasks (
    task_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    assigned_to INTEGER,
    title TEXT NOT NULL,
    status TEXT CHECK(status IN ('todo', 'in-progress', 'done')),
    github_issue_url TEXT, -- optional link to GitHub Issues
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (assigned_to) REFERENCES users(user_id)
);

-- checkins table: daily updates
CREATE TABLE checkins (
    checkin_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    project_id INTEGER,
    status_mood TEXT,
    work_done TEXT,
    work_planned TEXT,
    checkin_date DATE DEFAULT (CURRENT_DATE),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

-- blockers table
CREATE TABLE blockers (
    blocker_id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin_id INTEGER,
    description TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT 0,
    resolved_at TIMESTAMP,
    FOREIGN KEY (checkin_id) REFERENCES checkins(checkin_id)
);