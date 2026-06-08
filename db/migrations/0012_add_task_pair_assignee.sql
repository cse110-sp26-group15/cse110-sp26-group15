-- Adds a pair-partner assignee to tasks so the XP and Scrum dashboards can
-- assign (and persist) a second person alongside the primary assignee. Stored
-- as a display name to match the task-card component's pair contract, which
-- keys the pair picker by full_name rather than user_id.
ALTER TABLE tasks ADD COLUMN pair_assignee TEXT;
