-- Initial Seed Data

-- seed users
INSERT INTO users (full_name, email, role) VALUES 
('Alex Rivera', 'arivera@ucsd.edu', 'Lead Developer'),
('Sam Chen', 'schen@ucsd.edu', 'UI/UX Designer'),
('Jordan Smith', 'jsmith@ucsd.edu', 'Product Owner'),
('SitRep-Bot-v1', 'agent@sesitrep.ai', 'AI-agent'); -- ai agent

-- seed projects
INSERT INTO projects (name, description) VALUES 
('SE SitRep Prototype', 'A tool for tracking small agile team status and blockers.');

-- seed members
INSERT INTO project_members (project_id, user_id) VALUES 
(1, 1), (1, 2), (1, 3), (1, 4);

-- seed tasks
INSERT INTO tasks (project_id, assigned_to, title, status, github_issue_url) VALUES 
(1, 2, 'Create User Personas', 'done', 'https://github.com/org/repo/issues/1'),
(1, 2, 'Develop Wireframes', 'in-progress', 'https://github.com/org/repo/issues/2'),
(1, 1, 'Build CI/CD Pipeline via GitHub Actions', 'todo', 'https://github.com/org/repo/issues/3'),
(1, 3, 'Draft Design Brief', 'done', 'https://github.com/org/repo/issues/4');

-- seed checkins
INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned) VALUES 
(1, 1, 'Productive', 'Setup basic repository structure and linting.', 'Initialize SQLite database.'),
(2, 1, 'A bit overwhelmed', 'Finished user stories.', 'Start prototyping UI in vanilla CSS.'),
(4, 1, 'Optimized', 'Scanned repository for LoC count and PR compliance.', 'Monitor upcoming sprint tasks.');

-- seed blockers
INSERT INTO blockers (checkin_id, description, is_resolved) VALUES 
(2, 'Waiting for TA approval on external CSS dependency.', 0);