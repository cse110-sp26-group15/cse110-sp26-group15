-- Dashboard API integration test fixture.
-- Apply: wrangler d1 execute cse110-sp26-group15 --local --file=./db/dashboard-test-seed.sql
-- Clear:  wrangler d1 execute cse110-sp26-group15 --local --file=./db/reset.sql

INSERT INTO users (full_name, email, role) VALUES
('Alex Rivera', 'arivera@ucsd.edu', 'Lead Developer'),
('Sam Chen', 'schen@ucsd.edu', 'UI/UX Designer');

INSERT INTO projects (name, description) VALUES
('SE SitRep Prototype', 'A tool for tracking status.'),
('Empty Project', NULL);

INSERT INTO project_members (project_id, user_id)
SELECT p.project_id, u.user_id
FROM projects p
JOIN users u ON u.email = 'arivera@ucsd.edu'
WHERE p.name = 'SE SitRep Prototype';

INSERT INTO tasks (project_id, assigned_to, title, status, github_issue_url)
SELECT p.project_id, u.user_id, 'Create User Personas', 'done', 'https://github.com/org/repo/issues/1'
FROM projects p
JOIN users u ON u.email = 'schen@ucsd.edu'
WHERE p.name = 'SE SitRep Prototype';

INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned, checkin_date)
SELECT u.user_id, p.project_id, 'Productive', 'Setup repo.', 'Initialize DB.', date('now')
FROM users u
JOIN projects p ON p.name = 'SE SitRep Prototype'
WHERE u.email = 'arivera@ucsd.edu';

INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned, checkin_date)
SELECT u.user_id, p.project_id, 'Steady', 'Yesterday work.', 'Yesterday plan.', date('now', '-1 day')
FROM users u
JOIN projects p ON p.name = 'SE SitRep Prototype'
WHERE u.email = 'arivera@ucsd.edu';

INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned, checkin_date)
SELECT u.user_id, p.project_id, 'Old', 'Should not appear.', 'Outside window.', date('now', '-3 days')
FROM users u
JOIN projects p ON p.name = 'SE SitRep Prototype'
WHERE u.email = 'arivera@ucsd.edu';

INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned, checkin_date)
SELECT u.user_id, p.project_id, 'Blocked', 'Waiting on approval.', 'Continue wireframes.', date('now')
FROM users u
JOIN projects p ON p.name = 'SE SitRep Prototype'
WHERE u.email = 'schen@ucsd.edu';

INSERT INTO blockers (checkin_id, description, is_resolved, task, helper)
SELECT checkin_id, 'Waiting for approval', 0, NULL, NULL
FROM checkins
WHERE work_done = 'Waiting on approval.';

INSERT INTO blockers (checkin_id, description, is_resolved, task, helper)
SELECT checkin_id, 'Resolved blocker', 1, NULL, NULL
FROM checkins
WHERE work_done = 'Waiting on approval.';
