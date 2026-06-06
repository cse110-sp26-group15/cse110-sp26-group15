-- ─────────────────────────────────────────────────────────────────────
-- Seed data: one example of every UI surface in the SitRep app.
--   • 3 projects, one per workflow (scrum / kanban / xp)
-- 	 • 5 humans + 2 AI agents, each agent owned by a human
--   • cross-project membership (incl. agents)
--   • sprints (active + past) for the scrum project
--   • tasks in every status, some unassigned, some without GH links
--   • agent-assigned tasks with reviewer + review_status set
--   • check-ins exercising every status_mood badge the UI knows
--   • blockers: resolved + unresolved, task-tagged + general, w/ + w/o helper
-- Password for every test user: TestPassword123
-- ─────────────────────────────────────────────────────────────────────

-- ── Users ─────────────────────────────────────────────────────────────
-- user_id 6 and 7 are AI agents (role='AI-agent'); the `agents` insert
-- below carries their type, owner, and last-active metadata.
INSERT INTO users (full_name, email, role, password_hash) VALUES
  ('Alex Rivera',       'arivera@ucsd.edu',     'Lead Developer', '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO'),
  ('Sam Chen',          'schen@ucsd.edu',       'UI/UX Designer', '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO'),
  ('Jordan Smith',      'jsmith@ucsd.edu',      'Product Owner',  '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO'),
  ('Wayne Dyer',        'wdyer@ucsd.edu',       'Engineer',       '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO'),
  ('Mia Carter',        'mcarter@ucsd.edu',     'QA Engineer',    '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO'),
  ('SitRep-Bot-v1',     'agent@sesitrep.ai',    'AI-agent',       '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO'),
  ('Spec-Reviewer-Bot', 'reviewer@sesitrep.ai', 'AI-agent',       '$2b$10$QiMvio0SLlpZwxKBhfPS2.KxdzYrScPgFe60nT2sULploQ1Y.JerO');

-- ── Projects (one of each workflow) ───────────────────────────────────
INSERT INTO projects (name, description, workflow, created_by) VALUES
  ('SE SitRep Prototype',  'Scrum-style team coordination demo.',   'scrum',  1),
  ('Mobile Companion App', 'Kanban-style flow for the mobile crew.', 'kanban', 4),
  ('Research Spike',       'XP-style rapid iteration project.',      'xp',     2);

-- ── Project members ───────────────────────────────────────────────────
-- Project 1 (scrum): everyone incl. both agents
-- Project 2 (kanban): Alex, Wayne, Mia + Spec-Reviewer-Bot
-- Project 3 (xp):    Sam, Jordan + SitRep-Bot-v1
INSERT INTO project_members (project_id, user_id) VALUES
  (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7),
  (2, 1), (2, 4), (2, 5), (2, 7),
  (3, 2), (3, 3), (3, 6);

-- ── Agents ────────────────────────────────────────────────────────────
-- 1:1 extension of the AI-agent users above. owner_user_id is the human
-- responsible for monitoring/managing each agent's work and is the
-- default reviewer for tasks assigned to that agent.
INSERT INTO agents (user_id, agent_type, owner_user_id, description, last_active_at) VALUES
  (6, 'standup-summarizer', 1, 'Auto-summarises overnight commits and posts a check-in.', datetime('now','-2 hours')),
  (7, 'spec-reviewer',      4, 'Reviews PR diffs against acceptance criteria.',            datetime('now','-15 minutes'));

-- ── Sprints ───────────────────────────────────────────────────────────
-- Active sprint contains today; previous sprint sits before it.
-- date('now','-3 days') / date('now','+10 days') keeps the active window
-- straddling "today" no matter when the seed runs.
INSERT INTO sprints (project_id, number, start_date, end_date, goal) VALUES
  (1, 1, date('now','-17 days'), date('now','-4 days'),  'Stand up the auth + project flow.'),
  (1, 2, date('now','-3 days'),  date('now','+10 days'), 'Wire dashboards to real APIs.'),
  (2, 1, date('now','-7 days'),  date('now','+7 days'),  'Ship mobile login screen.'),
  (3, 1, date('now','-1 days'),  date('now','+6 days'),  'Prototype rapid check-in UX.');

-- ── Tasks ─────────────────────────────────────────────────────────────
-- Project 1: hits every status, mix of assigned + unassigned, with + without GH URL.
-- Human-assigned tasks leave reviewer_id NULL and review_status defaults
-- to 'not-required'. Agent-assigned tasks (further down) carry both.
INSERT INTO tasks (project_id, assigned_to, title, status, github_issue_url) VALUES
  (1, 2, 'Create user personas',                  'done',        'https://github.com/org/repo/issues/1'),
  (1, 2, 'Develop wireframes',                    'in-progress', 'https://github.com/org/repo/issues/2'),
  (1, 1, 'Build CI/CD pipeline via GitHub Actions','todo',       'https://github.com/org/repo/issues/3'),
  (1, 3, 'Draft design brief',                    'done',        NULL),
  (1, 4, 'Wire dashboard to live API',            'in-progress', 'https://github.com/org/repo/issues/12'),
  (1, NULL, 'Triage backlog for sprint 3',        'todo',        NULL),
  (1, 5, 'Write end-to-end smoke tests',          'todo',        'https://github.com/org/repo/issues/15'),
  -- Project 2 (kanban) — covers all four columns including any "blocked"
  -- column the kanban UI surfaces via task status / blocker join.
  (2, 4, 'Set up Expo build pipeline',            'done',        'https://github.com/org/mobile/issues/1'),
  (2, 1, 'Mobile login screen',                   'in-progress', 'https://github.com/org/mobile/issues/2'),
  (2, 5, 'QA pass on offline-mode',               'todo',        NULL),
  (2, NULL, 'Pick app icon palette',              'todo',        NULL),
  -- Project 3 (xp) — sparse but exercises the XP "assigned tasks" list.
  (3, 2, 'Spike: voice-to-text check-ins',        'in-progress', NULL),
  (3, 3, 'Recruit testers for rapid loop',        'todo',        NULL);

-- Agent-assigned tasks. Each carries reviewer_id (the human accountable
-- for the work) and a non-default review_status so the UI exercises the
-- 'pending' / 'approved' / 'needs-revision' badge colors.
INSERT INTO tasks (project_id, assigned_to, title, status, reviewer_id, review_status) VALUES
  (1, 6, 'Generate weekly status digest',           'done',        1, 'approved'),
  (1, 6, 'Agent: draft sprint retrospective notes', 'in-progress', 1, 'pending'),
  (1, 7, 'Agent: audit PR #142 vs acceptance criteria', 'in-progress', 4, 'pending'),
  (2, 7, 'Agent: classify mobile crash reports',    'todo',        4, 'pending'),
  (3, 6, 'Agent: summarise overnight commits',      'done',        2, 'needs-revision');

-- Give the seeded tasks a spread of urgencies and creation times so the task
-- card's urgency banner and "Created · how long ago" strip show realistic
-- variety. created_at is nullable (ALTER-added), so set it explicitly here;
-- both columns key off task_id purely to vary the values.
UPDATE tasks
   SET priority = CASE task_id % 4
                    WHEN 0 THEN 'urgent'
                    WHEN 1 THEN 'high'
                    WHEN 2 THEN 'medium'
                    ELSE 'low'
                  END,
       created_at = datetime('now', '-' || (task_id * 2) || ' days');

-- Pair up a couple of tasks on the dashboard project (project 1) so the XP
-- dashboard shows the second pair-partner avatar + picker alongside the
-- primary assignee. Partners are project-1 members so the inline pair picker
-- pre-selects correctly, and they line up with the pair sessions seeded below.
UPDATE tasks SET pair_assignee = 'Jordan Smith'
  WHERE project_id = 1 AND title = 'Develop wireframes';
UPDATE tasks SET pair_assignee = 'Mia Carter'
  WHERE project_id = 1 AND title = 'Wire dashboard to live API';

-- ── Pair Programming sessions ─────────────────────────────────────────
-- Seed pair sessions matching the task pair-partners above so the XP
-- dashboard's pairing section is populated and the two views stay in sync.
INSERT INTO xp_pairs (project_id, member1_id, member2_id) VALUES
  (1, 2, 3),  -- Sam Chen ↔ Jordan Smith
  (1, 4, 5);  -- Wayne Dyer ↔ Mia Carter

-- ── Check-ins ─────────────────────────────────────────────────────────
-- Exercises every status_mood string the UI special-cases:
--   scrum.js classifyMood():  "block", "help"/"overwhelm"/"stuck", default
--   main.js badgeClassFor():  on-track, blocked, in-progress, needs-review, running
-- Plus AI-agent check-ins so the "AI" badge renders on the feed.
INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned, checkin_date) VALUES
  (1, 1, 'on-track',          'Set up repo structure and linting.',          'Initialise SQLite database.',    date('now')),
  (2, 1, 'in-progress',       'Wired the task-card component into kanban.',  'Pair with Alex on auth flow.',   date('now')),
  (3, 1, 'needs-review',      'Drafted personas and wireframes.',            'Get TA sign-off on layouts.',    date('now')),
  (4, 1, 'blocked',           'Hit auth issues wiring up dashboard API.',    'Pair with Alex tomorrow.',       date('now')),
  (5, 1, 'A bit overwhelmed', 'Caught up on QA backlog.',                    'Triage flaky tests.',            date('now')),
  (6, 1, 'Optimized',         'Scanned repo for LoC count + PR compliance.', 'Monitor upcoming sprint tasks.', date('now')),
  (7, 1, 'on-track',          'Audited 4 PRs against acceptance criteria.',  'Run nightly diff scan.',         date('now')),
  -- Project 2 (kanban)
  (4, 2, 'on-track',          'Shipped Expo build script.',                  'Polish login screen.',           date('now','-1 day')),
  (1, 2, 'running',           'Auth integration started.',                   'Wire token refresh path.',       date('now')),
  -- Project 3 (xp) — short, rapid updates
  (2, 3, 'on-track',          'Spike on Whisper API for voice notes.',       'Wire transcript into form.',     date('now')),
  (6, 3, 'in-progress',       'Summarised 12 commits since last check-in.',  'Score commit risk levels.',      date('now'));

-- ── Blockers ──────────────────────────────────────────────────────────
-- The frontend distinguishes these axes:
--   • is_resolved          → RESOLVED vs BLOCKED pill colour
--   • task IS NULL/''      → "general" rail row vs task-scoped row
--   • helper IS NULL/value → presence of the "Can help" avatar
-- Seed at least one of each combination + one raised by an agent.
INSERT INTO blockers (checkin_id, description, task, helper, is_resolved) VALUES
  (4, 'Auth middleware rewrite blocked on legal review.', 'Wire dashboard to live API', 'Alex Rivera', 0),
  (5, 'Need access to the staging Slack workspace.',       NULL,                        NULL,          0),
  (3, 'Figma file is missing dark-mode tokens.',           'Develop wireframes',        'Sam Chen',    1),
  (7, 'Agent: missing context for 3 PRs — owner ping.',    'Agent: audit PR #142 vs acceptance criteria', 'Wayne Dyer', 0),
  (8, 'Apple developer account renewal stuck in finance.', NULL,                        'Wayne Dyer',  0);
