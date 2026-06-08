-- Associates a task with the sprint it belongs to. Nullable because tasks
-- created outside an active sprint (backlog) have no sprint, and existing
-- rows from before this migration didn't carry one. The scrum dashboard
-- already passes sprint_id on POST; before this column existed the server
-- silently dropped it, so the "tasks per sprint" view was always empty.
ALTER TABLE tasks ADD COLUMN sprint_id INTEGER REFERENCES sprints(sprint_id);

-- The hot lookup is "all tasks for sprint N of project P"; a single-column
-- index on sprint_id is enough since project scoping happens via a join.
CREATE INDEX idx_tasks_sprint ON tasks(sprint_id);
