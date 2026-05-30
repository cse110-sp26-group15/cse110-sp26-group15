-- The task-form modal already collects a description from users; this
-- adds the column so the value is actually persisted instead of being
-- silently dropped by the POST /api/projects/:id/tasks handler.
ALTER TABLE tasks ADD COLUMN description TEXT;
